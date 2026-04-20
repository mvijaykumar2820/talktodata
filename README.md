# TalkToData: AI-Powered Conversational Data Analysis

TalkToData is a web application that allows users to upload CSV datasets and interact with them using natural language. The platform transforms raw data into actionable insights through AI-generated summaries, interactive grids, and dynamic visualizations.

## 🚀 Key Features

* **Interactive Chat Interface**: Ask questions about your data in plain English and receive instant answers.
* **Dynamic Data Visualization**: Automatically generates charts (Bar, Line, Pie, etc.) based on your queries.
* **Comprehensive Data Summaries**: Get high-level overviews of your dataset's structure and key metrics.
* **Interactive Data Grid**: View and filter your raw data directly within the application.
* **Secure Authentication**: User accounts and data are managed through Firebase.

## 🛠️ Tech Stack

### Frontend
* **Framework**: React.js (Vite)
* **Styling**: CSS with a focus on clean, responsive UI
* **Visualization**: Recharts for dynamic charting
* **Data Handling**: TanStack Table (React Table) for high-performance grids

### Backend
* **Framework**: FastAPI
* **Language**: Python
* **Data Processing**: Pandas for CSV manipulation and analysis
* **AI Integration**: Powered by Large Language Models (via OpenAI/LangChain)

## ⚙️ Setup and Installation

### Backend Setup
1.  Navigate to the `backend` directory.
2.  Install the required Python packages:
    ```bash
    pip install -r requirements.txt
    ```
3.  Configure your environment variables (refer to `.env.example`).
4.  Launch the FastAPI server:
    ```bash
    python main.py
    ```

### Frontend Setup
1.  Navigate to the `frontend` directory.
2.  Install the dependencies:
    ```bash
    npm install
    ```
3.  Set up your Firebase configuration in `src/firebase.js`.
4.  Start the development server:
    ```bash
    npm run dev
    ```

## 📂 Project Structure

* `backend/`: Contains the FastAPI application, data processing logic, and CSV upload handling.
* `frontend/src/components/`: Houses the core UI elements like the `Chart`, `DataGrid`, and `Setup` modules.
* `frontend/src/utils/`: Contains API integration logic for communicating with the backend.
