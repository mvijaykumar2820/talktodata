from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import requests
import json
import io
import os
from typing import Optional, List
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

global_df = None
uploaded_datasets = {}

def read_any_csv(source):
    """
    Reads any CSV file including WebArchive format.
    Accepts file path string or raw bytes.
    """
    import io
    import re
    import pandas as pd

    # Get raw bytes
    if isinstance(source, str):
        with open(source, 'rb') as f:
            raw_bytes = f.read()
    else:
        raw_bytes = bytes(source)

    if len(raw_bytes) == 0:
        raise ValueError("File is empty.")

    # ── STRATEGY 1: WebArchive extraction ──────────────────────
    # WebArchive files contain the real data as text inside them
    # Try to find and extract the CSV content from the wrapper
    try:
        # Decode with latin-1 which handles any byte
        raw_text = raw_bytes.decode('latin-1', errors='replace')

        # Look for CSV content starting with Campaign_ID
        # or any line that looks like CSV headers
        csv_start_patterns = [
            r'Campaign_ID,',
            r'campaign_id,',
            r'Campaign_ID\r\n',
        ]

        extracted = None
        for pattern in csv_start_patterns:
            match = re.search(pattern, raw_text)
            if match:
                # Extract everything from the CSV header onwards
                csv_text = raw_text[match.start():]

                # Clean up HTML entities and WebArchive artifacts
                csv_text = csv_text.replace('&lt;', '<')
                csv_text = csv_text.replace('&gt;', '>')
                csv_text = csv_text.replace('&amp;', '&')
                csv_text = csv_text.replace('&#39;', "'")
                csv_text = csv_text.replace('&quot;', '"')

                # Remove any trailing HTML/XML tags
                # Stop at </pre> or </body> or similar
                end_patterns = ['</pre>', '</body>', '</html>',
                               '</', '\x00']
                for end_pat in end_patterns:
                    end_idx = csv_text.find(end_pat)
                    if end_idx > 0:
                        csv_text = csv_text[:end_idx]

                # Clean whitespace
                csv_text = csv_text.strip()

                if len(csv_text) > 100:
                    extracted = csv_text
                    break

        if extracted:
            df = pd.read_csv(
                io.StringIO(extracted),
                on_bad_lines='skip',
                skip_blank_lines=True
            )
            if len(df.columns) > 1 and len(df) > 0:
                df.columns = df.columns.str.strip()
                return df

    except Exception as e:
        pass  # Fall through to next strategy

    # ── STRATEGY 2: Try plistlib for binary plist format ───────
    # BPLIST00 means it's a binary plist (Apple format)
    # The actual data is stored as a string value inside
    try:
        import plistlib
        plist_data = plistlib.loads(raw_bytes)

        # plist_data is a dict, find the string value with CSV data
        def find_csv_in_plist(obj, depth=0):
            if depth > 5:
                return None
            if isinstance(obj, str) and 'Campaign_ID' in obj:
                return obj
            if isinstance(obj, dict):
                for v in obj.values():
                    result = find_csv_in_plist(v, depth+1)
                    if result:
                        return result
            if isinstance(obj, (list, tuple)):
                for item in obj:
                    result = find_csv_in_plist(item, depth+1)
                    if result:
                        return result
            if isinstance(obj, bytes):
                try:
                    decoded = obj.decode('utf-8', errors='ignore')
                    if 'Campaign_ID' in decoded:
                        return decoded
                except:
                    pass
            return None

        csv_content = find_csv_in_plist(plist_data)
        if csv_content:
            df = pd.read_csv(
                io.StringIO(csv_content),
                on_bad_lines='skip',
                skip_blank_lines=True
            )
            if len(df.columns) > 1 and len(df) > 0:
                df.columns = df.columns.str.strip()
                return df

    except Exception as e:
        pass  # Fall through to next strategy

    # ── STRATEGY 3: Find CSV by scanning for header pattern ────
    try:
        # Try different encodings to find readable text
        for enc in ['utf-8', 'utf-8-sig', 'latin-1', 'cp1252']:
            try:
                text = raw_bytes.decode(enc, errors='ignore')

                # Find lines that look like CSV data
                lines = text.split('\n')
                csv_lines = []
                found_header = False

                for line in lines:
                    line = line.strip()
                    # Check if this looks like the header
                    if ('Campaign_ID' in line and
                            'Campaign_Type' in line):
                        found_header = True
                        csv_lines = [line]
                    elif found_header and line and ',' in line:
                        # Check it looks like data (has NY-CMP or similar)
                        csv_lines.append(line)
                    elif found_header and not line:
                        # Empty line might end the data
                        if len(csv_lines) > 100:
                            break

                if len(csv_lines) > 10:
                    csv_text = '\n'.join(csv_lines)
                    df = pd.read_csv(
                        io.StringIO(csv_text),
                        on_bad_lines='skip'
                    )
                    if len(df.columns) > 1 and len(df) > 0:
                        df.columns = df.columns.str.strip()
                        return df
            except Exception:
                continue

    except Exception as e:
        pass

    # ── STRATEGY 4: Standard CSV reading ───────────────────────
    # Try as a normal CSV with multiple encodings and separators
    try:
        import chardet
        detected = chardet.detect(raw_bytes[:10000])
        detected_enc = detected.get('encoding') or 'utf-8'
    except Exception:
        detected_enc = 'utf-8'

    encodings = []
    for e in [detected_enc, 'utf-8', 'utf-8-sig',
              'latin-1', 'cp1252']:
        if e and e not in encodings:
            encodings.append(e)

    separators = [',', ';', '\t', '|']
    last_error = None

    for enc in encodings:
        for sep in separators:
            try:
                buf = io.BytesIO(raw_bytes)
                df = pd.read_csv(
                    buf,
                    encoding=enc,
                    sep=sep,
                    on_bad_lines='skip',
                    engine='python',
                    skip_blank_lines=True
                )
                if len(df.columns) > 1 and len(df) > 0:
                    df.columns = df.columns.str.strip()
                    # Check if it has expected columns
                    if 'Campaign_ID' in df.columns:
                        return df
            except Exception as e:
                last_error = e
                continue

    # Last resort - try reading and return whatever we got
    for enc in encodings:
        try:
            buf = io.BytesIO(raw_bytes)
            df = pd.read_csv(buf, encoding=enc,
                           on_bad_lines='skip',
                           engine='python')
            if len(df.columns) > 1 and len(df) > 0:
                df.columns = df.columns.str.strip()
                return df
        except Exception as e:
            last_error = e

    raise ValueError(
        "The CSV file appears to be in Safari WebArchive format "
        "which cannot be read directly. "
        "To fix this: Open the file in WPS Office or Excel, "
        "click File → Save As, choose CSV format, "
        "save it, then upload the new file."
    )

def process_dataframe(df):
    if df.empty:
        return df
    if "Date" in df.columns:
        date_series = pd.to_datetime(df["Date"], format="%d-%m-%Y", errors='coerce')
        df["_month_label"] = date_series.dt.strftime("%b %y")
        
        def get_quarter(dt):
            if pd.isna(dt): return None
            return f"Q{dt.quarter} {dt.year}"
            
        df["_quarter"] = date_series.apply(get_quarter)
    
    if "Channel_Used" in df.columns:
        df["_primary_channel"] = df["Channel_Used"].astype(str).str.split(",").str[0].str.strip()
    return df

@app.on_event("startup")
def startup_event():
    global global_df
    try:
        if os.path.exists("nykaa_data.csv"):
            try:
                df = read_any_csv("nykaa_data.csv")
                
                # Strip whitespace from all column names
                df.columns = df.columns.str.strip()
                
                # Strip whitespace from all string values in key columns
                string_cols = ['Campaign_Type', 'Target_Audience', 'Language',
                               'Channel_Used', 'Customer_Segment', 'Campaign_ID']
                for col in string_cols:
                    if col in df.columns:
                        df[col] = df[col].astype(str).str.strip()
                
                global_df = process_dataframe(df)
            except Exception as e:
                print(f"Error loading init data with read_any_csv: {e}")
                global_df = pd.DataFrame()
            
            if not global_df.empty:
                print(f"Successfully loaded {len(global_df)} rows")
        else:
            print("nykaa_data.csv not found, starting with empty DF")
            global_df = pd.DataFrame()
    except Exception as e:
        print(f"General error in startup_event: {e}")
        global_df = pd.DataFrame()

class QueryRequest(BaseModel):
    question: str
    history: List[dict] = []
    api_key: str
    dataset: str = "nykaa"

class UploadResponse(BaseModel):
    key: str
    columns: list
    row_count: int
    preview: list

SYSTEM_PROMPT = """You are a data analyst AI for Nykaa marketing intelligence.

Dataset: nykaa_data.csv
Rows: 55,555 Nykaa digital marketing campaign records
Date range: July 2024 to June 2025

COLUMNS AND RULES:
Campaign_ID: String
Campaign_Type: Categorical (Social Media, Paid Ads, Influencer, Email, SEO)
Target_Audience: Categorical (College Students, Youth, Working Women, Premium Shoppers, Tier 2 City Customers)
Duration: Integer (DAYS, AVERAGE when comparing)
Channel_Used: Categorical but MULTI-VALUE. Always split by comma and use only the FIRST channel.
Impressions: Integer (always SUM)
Clicks: Integer (always SUM)
Leads: Integer (always SUM)
Conversions: Integer (always SUM)
Revenue: Float (INR, always SUM)
Acquisition_Cost: Float (INR, ALWAYS AVERAGE)
ROI: Float (ALWAYS AVERAGE)
Language: Categorical (Hindi, English, Tamil, Bengali)
Engagement_Score: Float (ALWAYS AVERAGE)
Customer_Segment: Categorical (Same as Target_Audience)
Date: String DD-MM-YYYY

Your task: Convert the user question into ONLY a JSON object.
No markdown. No backticks. No explanation. Just the JSON.

JSON schema to return:
{
  "canAnswer": true or false,
  "cannotAnswerReason": "string or null",
  "chartType": "bar|line|area|pie|donut|scatter|table",
  "title": "descriptive chart title",
  "groupBy": "column name or _month_label or _quarter or _primary_channel or null",
  "metric": "column name to measure",
  "secondMetric": "column name or null",
  "aggregation": "sum|avg|count|max|min",
  "filters": [{"column": "...", "op": "eq|contains|gt|lt", "value": "..."}],
  "sortBy": "value_desc|value_asc|name|null",
  "limit": "number or null",
  "insight": "one sentence business insight",
  "xAxisLabel": "label string",
  "yAxisLabel": "label string"
}

Chart selection rules:
- Monthly/quarterly/over time/trend -> line or area
- Split/share/breakdown/proportion -> pie or donut
- Compare categories -> bar
- Two metrics together -> bar with secondMetric
- Correlation/relationship -> scatter
- Top N or ranked list -> table or bar with sortBy value_desc
- Outside dataset scope -> canAnswer: false

Examples:
- "revenue by campaign type"
{"canAnswer":true,"cannotAnswerReason":null,"chartType":"bar","title":"Revenue by Campaign Type","groupBy":"Campaign_Type","metric":"Revenue","secondMetric":null,"aggregation":"sum","filters":[],"sortBy":"value_desc","limit":null,"insight":"Revenue generated across each campaign type.","xAxisLabel":"Type","yAxisLabel":"Revenue"}
- "monthly conversion trend"
{"canAnswer":true,"cannotAnswerReason":null,"chartType":"area","title":"Monthly Conversion Trend","groupBy":"_month_label","metric":"Conversions","secondMetric":null,"aggregation":"sum","filters":[],"sortBy":"null","limit":null,"insight":"Conversion trends over time.","xAxisLabel":"Month","yAxisLabel":"Conversions"}
- "which language has best ROI"
{"canAnswer":true,"cannotAnswerReason":null,"chartType":"bar","title":"Best ROI by Language","groupBy":"Language","metric":"ROI","secondMetric":null,"aggregation":"avg","filters":[],"sortBy":"value_desc","limit":null,"insight":"Average ROI for each language.","xAxisLabel":"Language","yAxisLabel":"ROI"}
- "top 5 campaigns by revenue"
{"canAnswer":true,"cannotAnswerReason":null,"chartType":"table","title":"Top 5 Campaigns by Revenue","groupBy":"Campaign_ID","metric":"Revenue","secondMetric":null,"aggregation":"sum","filters":[],"sortBy":"value_desc","limit":5,"insight":"Highest revenue generating campaigns.","xAxisLabel":"Campaign ID","yAxisLabel":"Revenue"}
- "revenue split by language"
{"canAnswer":true,"cannotAnswerReason":null,"chartType":"pie","title":"Revenue Split by Language","groupBy":"Language","metric":"Revenue","secondMetric":null,"aggregation":"sum","filters":[],"sortBy":"value_desc","limit":null,"insight":"Proportion of revenue generated by each language.","xAxisLabel":"Language","yAxisLabel":"Revenue"}
- "compare ROI and acquisition cost by audience"
{"canAnswer":true,"cannotAnswerReason":null,"chartType":"bar","title":"ROI and Acquisition Cost by Audience","groupBy":"Target_Audience","metric":"ROI","secondMetric":"Acquisition_Cost","aggregation":"avg","filters":[],"sortBy":"null","limit":null,"insight":"Comparing investment returns and acquisition costs across audiences.","xAxisLabel":"Target Audience","yAxisLabel":"Value"}
- "quarterly impressions"
{"canAnswer":true,"cannotAnswerReason":null,"chartType":"line","title":"Quarterly Impressions","groupBy":"_quarter","metric":"Impressions","secondMetric":null,"aggregation":"sum","filters":[],"sortBy":"null","limit":null,"insight":"Impressions trend over quarters.","xAxisLabel":"Quarter","yAxisLabel":"Impressions"}
- "which channel gets most clicks"
{"canAnswer":true,"cannotAnswerReason":null,"chartType":"bar","title":"Most Clicks by Channel","groupBy":"_primary_channel","metric":"Clicks","secondMetric":null,"aggregation":"sum","filters":[],"sortBy":"value_desc","limit":null,"insight":"Clicks volume by different channels.","xAxisLabel":"Channel","yAxisLabel":"Clicks"}
- "engagement score by campaign type"
{"canAnswer":true,"cannotAnswerReason":null,"chartType":"bar","title":"Engagement Score by Campaign Type","groupBy":"Campaign_Type","metric":"Engagement_Score","secondMetric":null,"aggregation":"avg","filters":[],"sortBy":"null","limit":null,"insight":"Average engagement per campaign type.","xAxisLabel":"Campaign Type","yAxisLabel":"Score"}
- "Hindi campaigns revenue by channel"
{"canAnswer":true,"cannotAnswerReason":null,"chartType":"bar","title":"Hindi Campaigns Revenue by Channel","groupBy":"_primary_channel","metric":"Revenue","secondMetric":null,"aggregation":"sum","filters":[{"column":"Language","op":"eq","value":"Hindi"}],"sortBy":"value_desc","limit":null,"insight":"Revenue through different channels for Hindi language campaigns.","xAxisLabel":"Channel","yAxisLabel":"Revenue"}
- "ROI vs acquisition cost scatter"
{"canAnswer":true,"cannotAnswerReason":null,"chartType":"scatter","title":"ROI vs Acquisition Cost","groupBy":null,"metric":"ROI","secondMetric":"Acquisition_Cost","aggregation":"avg","filters":[],"sortBy":"null","limit":null,"insight":"ROI verses Acquisition Cost.","xAxisLabel":"ROI","yAxisLabel":"Cost"}
- "how many campaigns per type"
{"canAnswer":true,"cannotAnswerReason":null,"chartType":"bar","title":"Campaigns per Type","groupBy":"Campaign_Type","metric":"Campaign_ID","secondMetric":null,"aggregation":"count","filters":[],"sortBy":"value_desc","limit":null,"insight":"Volume of campaigns launched per category.","xAxisLabel":"Type","yAxisLabel":"Count"}
- "working women campaign performance monthly"
{"canAnswer":true,"cannotAnswerReason":null,"chartType":"area","title":"Working Women Performance Monthly","groupBy":"_month_label","metric":"Revenue","secondMetric":null,"aggregation":"sum","filters":[{"column":"Target_Audience","op":"eq","value":"Working Women"}],"sortBy":"null","limit":null,"insight":"Revenue from working women over time.","xAxisLabel":"Month","yAxisLabel":"Revenue"}
- "average acquisition cost by language"
{"canAnswer":true,"cannotAnswerReason":null,"chartType":"bar","title":"Average Acquisition Cost by Language","groupBy":"Language","metric":"Acquisition_Cost","secondMetric":null,"aggregation":"avg","filters":[],"sortBy":"value_asc","limit":null,"insight":"Cost per acquisition grouped by language.","xAxisLabel":"Language","yAxisLabel":"Cost"}
- "what is competitor revenue"
{"canAnswer":false,"cannotAnswerReason":"Dataset only contains Nykaa campaign data. No competitor information available.","chartType":"table","title":"","groupBy":null,"metric":"","secondMetric":null,"aggregation":"sum","filters":[],"sortBy":null,"limit":null,"insight":"","xAxisLabel":"","yAxisLabel":""}

The conversation history will be provided. Use it to understand follow-up questions. If user says 'now filter to Hindi only' after a previous chart, apply that filter to the same recipe.
"""

def call_gemini(question, history, api_key, custom_columns=None):
    full_prompt = SYSTEM_PROMPT
    if custom_columns:
        full_prompt += f"\nCUSTOM DATASET COLUMNS: {', '.join(custom_columns)}"
    
    if history:
        full_prompt += "\nHistory:\n"
        for h in history[-3:]:
            full_prompt += f"Previous Q: {h.get('question', '')}\nPrevious Recipe: {json.dumps(h.get('recipe', {}))}\n"
            
    full_prompt += f"\nCurrent question: {question}"
    
    api_key_to_use = os.environ.get("GEMINI_API_KEY") or api_key
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key_to_use}"
    
    body = {
        "contents": [{"parts": [{"text": full_prompt}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 1000}
    }
    
    response = requests.post(url, json=body)
    data = response.json()
    if "API key not valid" in str(data) or response.status_code == 400:
        raise Exception("API key is invalid")
    if "candidates" not in data:
         raise Exception("API error")
    text = data["candidates"][0]["content"]["parts"][0]["text"]
    clean = text.replace("```json", "").replace("```", "").strip()
    return json.loads(clean)

def aggregate(df, recipe):
    filtered_df = df.copy()
    for f in recipe.get("filters", []):
        c, o, v = f.get("column"), f.get("op"), f.get("value")
        if c not in filtered_df.columns: continue
        if o == "eq": filtered_df = filtered_df[filtered_df[c].astype(str).str.lower() == str(v).lower()]
        elif o == "contains": filtered_df = filtered_df[filtered_df[c].astype(str).str.contains(str(v), case=False, na=False)]
        elif o == "gt": filtered_df = filtered_df[filtered_df[c] > float(v)]
        elif o == "lt": filtered_df = filtered_df[filtered_df[c] < float(v)]
        
    gcol, metric, agg, sec_metric = recipe.get("groupBy"), recipe.get("metric"), recipe.get("aggregation"), recipe.get("secondMetric")
    
    if gcol not in filtered_df.columns:
         gcol = None
    if metric not in filtered_df.columns:
         if agg == 'count': metric = list(filtered_df.columns)[0]
         else: return []
         
    if gcol is None:
        if agg == "sum": val = filtered_df[metric].sum()
        elif agg == "avg": val = filtered_df[metric].mean()
        elif agg == "count": val = filtered_df[metric].count()
        elif agg == "max": val = filtered_df[metric].max()
        elif agg == "min": val = filtered_df[metric].min()
        else: val = 0
        res = [{"name": metric, "value": round(float(val), 2)}]
        if sec_metric and sec_metric in filtered_df.columns:
             res[0]["value2"] = round(float(filtered_df[sec_metric].mean() if agg == 'avg' else filtered_df[sec_metric].sum()), 2)
        return res
        
    if agg == "sum": grouped = filtered_df.groupby(gcol)[metric].sum()
    elif agg == "avg": grouped = filtered_df.groupby(gcol)[metric].mean()
    elif agg == "count": grouped = filtered_df.groupby(gcol)[metric].count()
    elif agg == "max": grouped = filtered_df.groupby(gcol)[metric].max()
    elif agg == "min": grouped = filtered_df.groupby(gcol)[metric].min()
    else: grouped = filtered_df.groupby(gcol)[metric].sum()
    
    df_res = grouped.reset_index().rename(columns={gcol: 'name', metric: 'value'})
    
    if sec_metric and sec_metric in filtered_df.columns:
         if agg == "sum": grouped2 = filtered_df.groupby(gcol)[sec_metric].sum()
         elif agg == "avg": grouped2 = filtered_df.groupby(gcol)[sec_metric].mean()
         else: grouped2 = filtered_df.groupby(gcol)[sec_metric].mean()
         df_res2 = grouped2.reset_index().rename(columns={gcol: 'name', sec_metric: 'value2'})
         df_res = pd.merge(df_res, df_res2, on='name', how='left')
         
    srt = recipe.get("sortBy")
    if srt == "value_desc": df_res = df_res.sort_values("value", ascending=False)
    elif srt == "value_asc": df_res = df_res.sort_values("value", ascending=True)
    elif srt == "name": df_res = df_res.sort_values("name", ascending=True)
    
    if gcol == "_month_label":
         try:
             df_res['temp'] = pd.to_datetime(df_res['name'], format='%b %y')
             df_res = df_res.sort_values('temp').drop(columns=['temp'])
         except: pass
         
    limit = recipe.get("limit")
    if limit: df_res = df_res.head(int(limit))
    
    return df_res.round(2).to_dict('records')

def calculate_kpis(df):
    cols = df.columns.tolist()
    kpis = {}

    kpis["totalRows"] = len(df)
    kpis["totalColumns"] = len(cols)

    # Force numeric conversion for key columns
    numeric_cols = ['Revenue', 'ROI', 'Engagement_Score',
                    'Impressions', 'Clicks', 'Leads',
                    'Conversions', 'Acquisition_Cost', 'Duration']
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    if "Revenue" in cols:
        total = df["Revenue"].sum()
        kpis["totalRevenue"] = round(float(total), 2)

    if "Campaign_ID" in cols:
        kpis["totalCampaigns"] = len(df)
        if "Revenue" in cols:
            idx = df["Revenue"].idxmax()
            kpis["bestCampaignId"] = str(
                df.loc[idx, "Campaign_ID"])

    if "ROI" in cols:
        avg_roi = df["ROI"].mean()
        kpis["avgROI"] = round(float(avg_roi), 2)

    if "_primary_channel" in df.columns and "Revenue" in cols:
        top_ch = (df.groupby("_primary_channel")["Revenue"]
                   .sum().idxmax())
        kpis["topChannel"] = str(top_ch)

    if "Language" in cols and "ROI" in cols:
        top_lang = (df.groupby("Language")["ROI"]
                    .mean().idxmax())
        kpis["topLanguage"] = str(top_lang)

    if "Engagement_Score" in cols:
        avg_eng = df["Engagement_Score"].mean()
        kpis["avgEngagement"] = round(float(avg_eng), 1)

    if "Conversions" in cols:
        kpis["totalConversions"] = int(df["Conversions"].sum())

    return kpis

@app.get("/api/kpis")
def kpis_endpoint():
    res = calculate_kpis(global_df)
    print(f"KPIs requested, returning: {res}")
    return res

@app.get("/api/data")
def data_endpoint(dataset: str = "nykaa"):
    df_use = global_df if dataset == "nykaa" else uploaded_datasets.get(dataset)
    if df_use is None or df_use.empty:
        return []
    # Return first 200 rows to keep it snappy but informative
    return df_use.head(200).fillna("").to_dict(orient="records")

@app.post("/api/query")
def query_endpoint(req: QueryRequest):
    df_use = global_df if req.dataset == "nykaa" else uploaded_datasets.get(req.dataset)
    if df_use is None or df_use.empty: return {"canAnswer": False, "reason": "Dataset is empty or not found."}
    
    try:
        recipe = call_gemini(req.question, req.history, req.api_key, list(df_use.columns) if req.dataset != "nykaa" else None)
    except Exception as e:
        return {"canAnswer": False, "reason": str(e)}
        
    if not recipe.get("canAnswer", False):
        return {"canAnswer": False, "reason": recipe.get("cannotAnswerReason")}
        
    chart_data = aggregate(df_use, recipe)
    return {
        "canAnswer": True,
        "recipe": recipe,
        "chartData": chart_data,
        "rowsAnalyzed": len(df_use)
    }

import time
@app.post("/api/upload")
async def upload_endpoint(file: UploadFile = File(...)):
    contents = await file.read()
    try:
        df = read_any_csv(contents)
        
        # Strip whitespace from all column names
        df.columns = df.columns.str.strip()
        
        # Strip whitespace from all string values in key columns
        string_cols = ['Campaign_Type', 'Target_Audience', 'Language',
                       'Channel_Used', 'Customer_Segment', 'Campaign_ID']
        for col in string_cols:
            if col in df.columns:
                df[col] = df[col].astype(str).str.strip()
                
        df = process_dataframe(df)
        key = str(int(time.time()))
        uploaded_datasets[key] = df
        return {
            "key": key,
            "columns": list(df.columns),
            "rowCount": len(df),
            "preview": df.head(3).fillna("").to_dict(orient="records")
        }
    except Exception as e:
        return {"error": str(e)}
