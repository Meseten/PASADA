import pandas as pd
import numpy as np
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import FranchiseRecord, RouteData
import traceback

# PERFORMANCE CACHE
_ML_CACHE = {}

def invalidate_ml_cache(route: str = None):
    """Invalidates cached ML data when writes occur."""
    global _ML_CACHE
    if route:
        route_upper = str(route).strip().upper()
        if route_upper in _ML_CACHE:
            del _ML_CACHE[route_upper]
    else:
        _ML_CACHE.clear()

def run_kmeans_clustering(db: Session, target_route: str):
    global _ML_CACHE
    target_route = str(target_route).strip().upper()
    
    # Return from cache if valid
    if target_route in _ML_CACHE:
        return _ML_CACHE[target_route]

    try:
        # STEP 1: DATA EXTRACTION (Ignore deleted records)
        fleet_counts = db.query(
            FranchiseRecord.route, 
            func.count(FranchiseRecord.id).label('fleet_size')
        ).filter(FranchiseRecord.is_active == True, FranchiseRecord.is_deleted == False).group_by(FranchiseRecord.route).all()
        
        if not fleet_counts:
            return []

        data = []
        for r in fleet_counts:
            route_name = str(r.route).strip().upper()
            fleet = r.fleet_size 
            
            route_info = db.query(RouteData).filter(RouteData.route_name == route_name).first()
            
            # PREVENT ZERO DIVISION CRASH
            pop = route_info.population if (route_info and route_info.population) else 5000      
            road = route_info.road_length_km if (route_info and route_info.road_length_km) else 5.0  
            
            pop = max(int(pop), 1)
            road = max(float(road), 0.1)
            
            density = (fleet / (pop * road)) * 1000
            
            data.append({
                "route": route_name,
                "fleet_size": fleet,
                "population": pop,
                "road_length": road,
                "density": density
            })
            
        df = pd.DataFrame(data)
        
        # DYNAMIC CLUSTERING TO PREVENT SKLEARN CRASHES
        unique_densities = df['density'].nunique()
        if len(df) < 3 or unique_densities < 2:
            df['cluster'] = 0
            df['severity'] = 0
        else:
            features = ['fleet_size', 'population', 'road_length']
            X = df[features]
            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X)
            
            n_clusters = min(3, unique_densities)
            kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
            df['cluster'] = kmeans.fit_predict(X_scaled)
            
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

        result = [{
            "forecast_period": status_map.get(severity, "GREEN CLUSTER: Under-saturated (Accept Applications)"), 
            "expected_renewals": fleet_val,  
            "model_confidence": f"Density Score: {round(density_val, 2)}",
            "feature_importances": importance_data,
            "historical_trend": [] 
        }]
        
        # Save to Cache
        _ML_CACHE[target_route] = result
        return result
        
    except Exception as e:
        print(f"ML Engine Crash: {e}")
        traceback.print_exc()
        return []