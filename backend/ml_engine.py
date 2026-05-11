import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error
from sqlalchemy.orm import Session
from database import FranchiseRecord
import calendar

def engineer_features(df, total_fleet_size):
    df = df.sort_values(by=['year', 'month'])
    df['time_index'] = (df['year'] - df['year'].min()) * 12 + df['month']
    df['cumulative_renewals'] = df['count'].cumsum()
    df['remaining_unrenewed'] = total_fleet_size - df['cumulative_renewals']
    df['is_deadline_month'] = df['month'].apply(lambda x: 1 if x in [1, 2, 12] else 0)
    df['is_holiday_season'] = df['month'].apply(lambda x: 1 if x in [4, 12] else 0)
    return df

def train_and_predict(db: Session, target_route: str):
    if target_route == "ALL":
        records = db.query(FranchiseRecord).filter(FranchiseRecord.is_active == True).all()
        total_fleet = db.query(FranchiseRecord).count()
    else:
        records = db.query(FranchiseRecord).filter(FranchiseRecord.route == target_route, FranchiseRecord.is_active == True).all()
        total_fleet = db.query(FranchiseRecord).filter(FranchiseRecord.route == target_route).count()
        
    if not records or len(records) < 5:
        return []

    df = pd.DataFrame([{"year": r.issue_date.year, "month": r.issue_date.month, "count": 1} for r in records if r.issue_date])
    df = df.groupby(['year', 'month']).sum().reset_index()
    
    df = engineer_features(df, total_fleet)

    features = ['time_index', 'month', 'remaining_unrenewed', 'is_deadline_month', 'is_holiday_season']
    X = df[features]
    y = df['count']

    model = RandomForestRegressor(n_estimators=200, max_depth=8, random_state=42)
    model.fit(X, y)
    
    mae_score = 0
    if len(df) > 8:
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        test_model = RandomForestRegressor(n_estimators=200, max_depth=8, random_state=42)
        test_model.fit(X_train, y_train)
        preds = test_model.predict(X_test)
        mae_score = mean_absolute_error(y_test, preds)

    importances = model.feature_importances_
    feature_names = ["Timeline Progression", "Seasonality (Month)", "Remaining Registrations", "Ordinance Deadlines", "Holiday/Peak Proximity"]
    importance_data = [{"factor": fname, "weight": round(float(imp) * 100, 1)} for fname, imp in zip(feature_names, importances)]
    importance_data = sorted(importance_data, key=lambda x: x['weight'], reverse=True)

    historical_trend = [{"month": f"{calendar.month_abbr[int(row['month'])]} '{str(int(row['year']))[-2:]}", "volume": int(row['count'])} for _, row in df.iterrows()]

    latest_year = df['year'].max()
    latest_month = df[df['year'] == latest_year]['month'].max()
    
    next_month = latest_month + 1 if latest_month < 12 else 1
    next_year = latest_year if latest_month < 12 else latest_year + 1
    
    next_time_index = (next_year - df['year'].min()) * 12 + next_month
    current_unrenewed = df['remaining_unrenewed'].iloc[-1]
    is_deadline = 1 if next_month in [1, 2, 12] else 0
    is_holiday = 1 if next_month in [4, 12] else 0

    future_features = pd.DataFrame({
        'time_index': [next_time_index],
        'month': [next_month],
        'remaining_unrenewed': [current_unrenewed],
        'is_deadline_month': [is_deadline],
        'is_holiday_season': [is_holiday]
    })

    prediction = model.predict(future_features)
    predicted_volume = max(0, int(round(prediction[0])))

    return [{
        "forecast_period": f"{calendar.month_name[next_month]} {next_year}", 
        "expected_renewals": predicted_volume,
        "model_confidence": f"± {round(mae_score)} Renewals",
        "feature_importances": importance_data,
        "historical_trend": historical_trend[-8:] 
    }]