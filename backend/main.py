from fastapi import FastAPI, UploadFile, File, HTTPException
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
    allow_origins=os.getenv("ALLOWED_ORIGINS", "*").split(","),
    allow_credentials=True,
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

class KPIRequest(BaseModel):
    dataset: str = "nykaa"

class InsightRequest(BaseModel):
    dataset: str = "nykaa"
    api_key: str
    data_point: str
    metric: str
    value: float
    context: str
    is_detailed: bool = False

class UploadResponse(BaseModel):
    key: str
    columns: list
    row_count: int
    preview: list

SYSTEM_PROMPT = """
Dataset context: {dataset_name}
Columns: {columns_list}

You are a sophisticated data analyst. 
If the user says things like "hi", "hello", "thanks", "who are you", etc., DO NOT return a data recipe. 
Instead, return a natural language response in this format:
{"canAnswer": true, "isGeneral": true, "response": "Your friendly response here"}

For data questions:
Convert the user question into ONLY a JSON object. No markdown. No backticks. Just the JSON.

Dataset Rules:
- Revenue: Float (INR, always SUM)
- ROI: Float (ALWAYS AVERAGE)
- Acquisition_Cost: Float (ALWAYS AVERAGE)
- Impressions/Clicks/Leads/Conversions: Integer (always SUM)
- Date: String DD-MM-YYYY (use _month_label or _quarter for time grouping)

JSON schema for data queries:
{
  "canAnswer": true,
  "isGeneral": false,
  "chartType": "bar|line|area|pie|donut|scatter|table",
  "title": "descriptive chart title",
  "groupBy": "column name or _month_label or _quarter or null",
  "metric": "column name to measure",
  "secondMetric": "column name or null",
  "aggregation": "sum|avg|count|max|min",
  "filters": [{"column": "...", "op": "eq|contains|gt|lt", "value": "..."}],
  "sortBy": "value_desc|value_asc|name|null",
  "limit": "number or null",
  "insight": "A comprehensive, highly detailed 5-8 sentence paragraph of business analysis based on the data requested. Deeply analyze trends, implications, and what the data tells us from a strategic standpoint.",
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

def call_gemini(question, history, api_key, dataset_name="Nykaa Campaigns", custom_columns=None):
    cols = custom_columns or ["Campaign_ID", "Campaign_Type", "Target_Audience", "Duration", "Channel_Used", "Impressions", "Clicks", "Leads", "Conversions", "Revenue", "Acquisition_Cost", "ROI", "Language", "Engagement_Score", "Customer_Segment", "Date"]
    full_prompt = SYSTEM_PROMPT.replace("{dataset_name}", dataset_name).replace("{columns_list}", ", ".join(cols))
    
    if history:
        full_prompt += "\nHistory:\n"
        for h in history[-3:]:
            full_prompt += f"Previous Q: {h.get('question', '')}\nPrevious Recipe: {json.dumps(h.get('recipe', {}))}\n"
            
    full_prompt += f"\nCurrent question: {question}"
    
    # Prefer user-provided key when present; fall back to server-managed key.
    # Decide which provider to use based on key/env.
    # If the frontend supplies a real key, prefer that provider.
    # Only use server-managed keys when the frontend sends "backend-managed-key".
    user_key = api_key if api_key and api_key != "backend-managed-key" else None

    # Prefer OpenRouter only when:
    # - the user explicitly supplied an OpenRouter key, OR
    # - no user key was supplied, and the server has OPENROUTER_API_KEY set,
    #   and there is no server-managed Gemini key present.
    #
    # This makes GEMINI_API_KEY the default "backend-managed" provider when both
    # are configured.
    openrouter_key = None
    if user_key and user_key.startswith("sk-or-"):
        openrouter_key = user_key
    elif not user_key:
        server_gemini_key = os.environ.get("GEMINI_API_KEY")
        if not server_gemini_key and os.environ.get("OPENROUTER_API_KEY"):
            openrouter_key = os.environ.get("OPENROUTER_API_KEY")

    if openrouter_key:
        # --- OpenRouter (OpenAI-compatible) path ---
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {openrouter_key}",
        }
        body = {
            "model": "openai/gpt-4o-mini",
            "messages": [
                {"role": "user", "content": full_prompt}
            ],
            "temperature": 0.1,
        }
        response = requests.post(url, json=body, headers=headers, timeout=30)
        try:
            data = response.json()
        except Exception:
            data = {"raw": response.text}

        if not response.ok:
            msg = None
            try:
                msg = data.get("error", {}).get("message")
            except Exception:
                msg = None
            if response.status_code in (401, 403):
                raise Exception(msg or "OpenRouter API key is invalid or unauthorized")
            if response.status_code == 429:
                raise Exception(msg or "OpenRouter API quota exceeded. Please retry later or use a different key.")
            raise Exception(msg or f"OpenRouter API error (HTTP {response.status_code})")

        try:
            text = data["choices"][0]["message"]["content"]
        except Exception:
            raise Exception("OpenRouter API returned an unexpected response format")

        clean = text.replace("```json", "").replace("```", "").strip()
        return json.loads(clean)

    # --- Fallback: Gemini path (existing behavior) ---
    api_key_to_use = user_key or os.environ.get("GEMINI_API_KEY")
    if not api_key_to_use:
        raise Exception("Missing LLM API key")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key_to_use}"
    body = {
        "contents": [{"parts": [{"text": full_prompt}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 1500}
    }

    response = requests.post(url, json=body, timeout=30)
    try:
        data = response.json()
    except Exception:
        data = {"raw": response.text}

    if not response.ok:
        msg = None
        try:
            msg = data.get("error", {}).get("message")
        except Exception:
            msg = None

        if response.status_code in (401, 403):
            raise Exception(msg or "Gemini API key is invalid or unauthorized")
        if response.status_code == 429:
            raise Exception(msg or "Gemini API quota exceeded. Please retry later or use your own API key.")
        raise Exception(msg or f"Gemini API error (HTTP {response.status_code})")

    if "candidates" not in data:
        msg = None
        try:
            msg = data.get("error", {}).get("message")
        except Exception:
            msg = None
        raise Exception(msg or "Gemini API returned an unexpected response")

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

    if "Target_Audience" in cols and "Revenue" in cols:
        top_audience = (df.groupby("Target_Audience")["Revenue"].sum().idxmax())
        kpis["topAudience"] = str(top_audience)

    # Calculate Year-over-Year Revenue if Date exists
    if "Date" in cols and "Revenue" in cols:
        # Create a temp datetime col to extract year safely
        temp_dates = pd.to_datetime(df["Date"], format="%d-%m-%Y", errors='coerce')
        df_years = df.copy()
        df_years["_year"] = temp_dates.dt.year
        
        rev_2024 = df_years[df_years["_year"] == 2024]["Revenue"].sum()
        rev_2025 = df_years[df_years["_year"] == 2025]["Revenue"].sum()
        
        kpis["rev2024"] = round(float(rev_2024), 2)
        kpis["rev2025"] = round(float(rev_2025), 2)

    # Build dynamic KPI cards for the frontend
    dynamic = []

    if "totalRevenue" in kpis:
        dynamic.append({
            "label": "TOTAL REVENUE",
            "value": f"{kpis['totalRevenue']:,}",
            "sub": "Sum of Revenue",
            "color": "#3b82f6",
        })

    if "avgROI" in kpis:
        dynamic.append({
            "label": "AVG ROI",
            "value": f"{kpis['avgROI']:.2f}x",
            "sub": "Average return on investment",
            "color": "#10b981",
        })

    if "totalConversions" in kpis:
        dynamic.append({
            "label": "CONVERSIONS",
            "value": f"{kpis['totalConversions']:,}",
            "sub": "Total conversions",
            "color": "#f59e0b",
        })

    if "topChannel" in kpis:
        dynamic.append({
            "label": "TOP PLATFORM",
            "value": kpis["topChannel"],
            "sub": "Highest revenue platform",
            "color": "#ec4899",
        })

    if "topAudience" in kpis:
        dynamic.append({
            "label": "TOP AUDIENCE",
            "value": kpis["topAudience"],
            "sub": "Most profitable segment",
            "color": "#eab308",
        })

    if "rev2024" in kpis and kpis["rev2024"] > 0:
        dynamic.append({
            "label": "2024 REVENUE",
            "value": f"{int(kpis['rev2024']):,}",
            "sub": "Total generated in 2024",
            "color": "#6366f1",
        })

    if "rev2025" in kpis and kpis["rev2025"] > 0:
        dynamic.append({
            "label": "2025 REVENUE",
            "value": f"{int(kpis['rev2025']):,}",
            "sub": "Total generated in 2025",
            "color": "#14b8a6",
        })

    if "avgEngagement" in kpis:
        dynamic.append({
            "label": "ENGAGEMENT",
            "value": f"{kpis['avgEngagement']:.1f}",
            "sub": "Average engagement score",
            "color": "#a855f7",
        })

    kpis["dynamicKpis"] = dynamic
    return kpis

@app.get("/api/kpis")
def kpis_endpoint(dataset: str = "nykaa"):
    df_use = global_df if dataset == "nykaa" else uploaded_datasets.get(dataset)
    if df_use is None or df_use.empty:
        return {}
    res = calculate_kpis(df_use)
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
    dataset_name = "Nykaa Campaigns" if req.dataset == "nykaa" else "Uploaded Dataset"
    
    if df_use is None or df_use.empty: 
        return {"canAnswer": False, "reason": "Dataset is empty or not found."}
    
    try:
        recipe = call_gemini(req.question, req.history, req.api_key, dataset_name, list(df_use.columns))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
        
    if recipe.get("isGeneral", False):
        return {
            "canAnswer": True,
            "isGeneral": True,
            "response": recipe.get("response")
        }

    if not recipe.get("canAnswer", False):
        return {"canAnswer": False, "reason": recipe.get("cannotAnswerReason")}
        
    chart_data = aggregate(df_use, recipe)
    return {
        "canAnswer": True,
        "isGeneral": False,
        "recipe": recipe,
        "chartData": chart_data,
        "rowsAnalyzed": len(df_use)
    }

@app.post("/api/insight")
def insight_endpoint(req: InsightRequest):
    df_use = global_df if req.dataset == "nykaa" else uploaded_datasets.get(req.dataset)
    dataset_name = "Nykaa Campaigns" if req.dataset == "nykaa" else "Uploaded Dataset"
    
    insight_length = "brief 1-2 sentence" if not req.is_detailed else "comprehensive, highly detailed 4-6 sentence paragraph"
    
    prompt = f"""
    Dataset context: {dataset_name}
    The user is looking at a chart about: {req.context}
    They {'clicked' if req.is_detailed else 'hovered'} over a specific data point:
    Name/Category: {req.data_point}
    Metric: {req.metric}
    Value: {req.value}
    
    Provide a {insight_length} AI insight explaining why this specific data point might have this value.
    {"If detailed, deeply analyze potential causes, underlying factors, and strategic business implications, giving a much deeper dive into what this number means." if req.is_detailed else "Keep it concise, punchy, and helpful."}
    Do not mention that you are an AI. Do not use JSON. Just write the text.
    """
    
    try:
        # Reuse call_gemini logic but bypass the JSON parsing and system prompt
        # A simpler direct call for plain text:
        user_key = req.api_key if req.api_key and req.api_key != "backend-managed-key" else None
        
        openrouter_key = None
        if user_key and user_key.startswith("sk-or-"):
            openrouter_key = user_key
        elif not user_key:
            server_gemini_key = os.environ.get("GEMINI_API_KEY")
            if not server_gemini_key and os.environ.get("OPENROUTER_API_KEY"):
                openrouter_key = os.environ.get("OPENROUTER_API_KEY")

        if openrouter_key:
            url = "https://openrouter.ai/api/v1/chat/completions"
            headers = {"Authorization": f"Bearer {openrouter_key}"}
            body = {
                "model": "openai/gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3,
            }
            res = requests.post(url, json=body, headers=headers, timeout=15).json()
            text = res["choices"][0]["message"]["content"].strip()
            return {"insight": text}
            
        api_key_to_use = user_key or os.environ.get("GEMINI_API_KEY")
        if not api_key_to_use: return {"insight": "Missing API key."}
        
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key_to_use}"
        body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.5, "maxOutputTokens": 800}
        }
        res = requests.post(url, json=body, timeout=15).json()
        text = res["candidates"][0]["content"]["parts"][0]["text"].strip()
        return {"insight": text}
        
    except Exception as e:
        return {"insight": "Could not generate insight for this point."}

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
        raise HTTPException(status_code=400, detail=str(e))
