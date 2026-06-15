import pandas as pd
import numpy as np
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import FranchiseRecord, RouteData

def run_kmeans_clustering(db: Session, target_route: str):
    
    # ==============================================================================
    # STEP 1: DATA EXTRACTION (Pulling X1, X2, X3 from the Database)
    # ==============================================================================
    # kukunin yung  Active Fleet Size (X1) per route by counting active MTOP records only
    fleet_counts = db.query(
        FranchiseRecord.route, 
        func.count(FranchiseRecord.id).label('fleet_size')
    ).filter(FranchiseRecord.is_active == True).group_by(FranchiseRecord.route).all()
    
    if not fleet_counts:
        return []

    data = []
    for r in fleet_counts:
        route_name = r.route
        fleet = r.fleet_size # Factor X1
        
        # Population (X2) and Road Length (X3). Default to 5000 pop / 5km pag walang dataset mula PSA and MEO
        route_info = db.query(RouteData).filter(RouteData.route_name == route_name).first()
        pop = route_info.population if route_info else 5000      # Factor X2
        road = route_info.road_length_km if route_info else 5.0  # Factor X3
        
        # formula ng Density Score: (Supply / (Demand * Space)) * 1000
        density = (fleet / (pop * road)) * 1000
        
        data.append({
            "route": route_name,
            "fleet_size": fleet,
            "population": pop,
            "road_length": road,
            "density": density
        })
        
    df = pd.DataFrame(data)
    
    # ==============================================================================
    # STEP 2: at least 3 datapoints para hidi magfail at makapaggroup yung algo.
    if len(df) < 3:
        df = pd.concat([df, df, df]).reset_index(drop=True)


    features = ['fleet_size', 'population', 'road_length']
    X = df[features]
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    # ==============================================================================
    # STEP 4: clustering
    # ==============================================================================
    kmeans = KMeans(n_clusters=3, random_state=42, n_init=10)
    df['cluster'] = kmeans.fit_predict(X_scaled)
    
    # ==============================================================================
    # STEP 5: MATHEMATICAL CLUSTER RANKING
    # The algorithm doesn't know which cluster is "Bad". must sort the clusters 
    # by their average Density Score to assign Green (0), Yellow (1), and Red (2).
    # ==============================================================================
    cluster_densities = df.groupby('cluster')['density'].mean().sort_values()
    ranking_map = {cluster_id: rank for rank, (cluster_id, _) in enumerate(cluster_densities.items())}
    df['severity'] = df['cluster'].map(ranking_map)
    
    target_data = df[df['route'] == target_route]
    
    if target_data.empty:
        severity, fleet_val, pop_val, road_val, density_val = 0, 0, 5000, 5.0, 0
    else:
        target_info = target_data.iloc[0]
        severity = int(target_info['severity'])
        fleet_val = int(target_info['fleet_size'])
        pop_val = int(target_info['population'])
        road_val = float(target_info['road_length'])
        density_val = float(target_info['density'])

    status_map = {
        0: "GREEN CLUSTER: Under-saturated (Accept Applications)", 
        1: "YELLOW CLUSTER: Optimal/Warning", 
        2: "RED CLUSTER: Over-saturated (Freeze Applications)"
    }
    
    max_fleet = df['fleet_size'].max() or 1
    max_pop = df['population'].max() or 1
    max_road = df['road_length'].max() or 1
    
    importance_data = [
        {"factor": "Active Fleet Size (Supply X1)", "weight": round((fleet_val / max_fleet) * 100, 1)},
        {"factor": "Barangay Population (Demand X2)", "weight": round((pop_val / max_pop) * 100, 1)},
        {"factor": "Road Network Length (Space X3)", "weight": round((road_val / max_road) * 100, 1)},
        {"factor": "Algorithm Density Score", "weight": round(min(density_val * 10, 100), 1)}
    ]

    return [{
        "forecast_period": status_map[severity], 
        "expected_renewals": fleet_val,  
        "model_confidence": f"Density Score: {round(density_val, 2)}",
        "feature_importances": importance_data,
        "historical_trend": [] 
    }]