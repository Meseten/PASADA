# 25010 Characteristic: Reliability

import pandas as pd #data manipulation and data analysis
import numpy as np #fast computing
from sklearn.cluster import KMeans #machine learning
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import silhouette_score, davies_bouldin_score, calinski_harabasz_score
from sqlalchemy.orm import Session #to talk to database(alchemy)
from sqlalchemy import func
from database import FranchiseRecord, RouteData #eto lang need for clustering since route data and franchise records lang need icompute to determine whether the route is saturated or not
import traceback

# PERFORMANCE CACHE
# serves as in-memory dictionary for the route cache, para hindi laging paulit-uit and computation kada efresh at mas bumilis ang performance and databse reads
_ML_CACHE = {}

def invalidate_ml_cache(route: str = None):
    """Invalidates cached ML data when writes occur."""
    # since may ml_cache kanina, once may update sa franchise record or route data, need iupdate yung ml to reflect, if walang invalidate endi sya madedelete so old data pa rin ang lalabas
    global _ML_CACHE
    if route:
        route_upper = str(route).strip().upper() #defense for typo, malagyan man ng space or small letter, msusunod pa rin yung standard
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
        fleet_counts = db.query( #imbis na i-pull yung 6,137 records into python, gumamit nalang ty ng  sqlite db engine. since db engine is written is C, it is faster to compile and compute so the output will just be push into python. this method will make it faster since instead of the 6, 137 data eating the ram, the db engine will just compute the fleet size per route and return the result to python. this is a better approach since it is faster and less memory intensive. 
            FranchiseRecord.route, 
            func.count(FranchiseRecord.id).label('fleet_size')
        ).filter(FranchiseRecord.is_active == True, FranchiseRecord.is_deleted == False).group_by(FranchiseRecord.route).all() #soft deletes, hindi pwede idelete yung mga franchise totally dahil may audit. so we just marked it as deleted, just like tombstones. minamarkahan na yung gantong record ay patay na at hindi na pwedeng buhayin, same principle with the sync_engine pag nag-edit and clerk A ng data ni Juan, at dinelete naman ni clerk B, both working on there own and offline, then nagonline sila ang nagsync. hindi babalik si Juan sa db dahil amy tombstone na sya. 
        
        if not fleet_counts:
            return []

        data = []
        for r in fleet_counts:
            route_name = str(r.route).strip().upper()
            fleet = r.fleet_size 
            
            route_info = db.query(RouteData).filter(RouteData.route_name == route_name).first()
            
            # PREVENT ZERO DIVISION CRASH
            # graceful degradation: if population or road length is missing, use default values (5000 for population, 5.0 km for road length)
            # pag default,ipapakita pa rin sya sa frontend na sya ay default with notif para hindi magbigay ng false info sa user na ang route ay ganto pa, reminder to update if there is available data for accuracy.
            pop = route_info.population if (route_info and route_info.population) else 5000      
            road = route_info.road_length_km if (route_info and route_info.road_length_km) else 5.0  

            # Graceful degradation: Ensure population and road length are not zero to avoid division by zero errors
            pop = max(int(pop), 1)
            road = max(float(road), 0.1)

            # multiplied by 1000 to convert to per 1000 people per km e.g., 0.5 means 0.5 operators per 1000 people per km of road
            density = (fleet / (pop * road)) * 1000
            
            data.append({
                "route": route_name,
                "fleet_size": fleet,
                "population": pop,
                "road_length": road,
                "density": density
            })

        # data prep, ialalgay into table y
        df = pd.DataFrame(data)
        
        # DYNAMIC CLUSTERING TO PREVENT SKLEARN CRASHES
        # since pwedeng may mga route na may 1 operator lang, or may 1 route lang, or may 1 density lang, so need to check if the data is enough to cluster, if not, just assign all to cluster 0 and severity 0
        unique_densities = df['density'].nunique()
        silhouette_val = 0.0
        davies_bouldin_val = 0.0
        calinski_harabasz_val = 0.0

        # If there are fewer than 3 data points or fewer than 2 unique densities, assign all to a single cluster and severity level.
        # hindi mo pwedeng hatiin sa tatlo, kung dalawa lang ang route. magkakaroon ng empty cluster. same when all the routes have the same density, mawawalan ng variance yung data.
        if len(df) < 3 or unique_densities < 2:
            df['cluster'] = 0
            df['severity'] = 0
        else:
            # FIX: Cluster directly on density to ensure strict monotonic severity mapping
            # goal: get the raw density and convert it into a z-score. where z-score is one way to measure how far a number to the average of the whole group.
            # kmeans uses euclidean distance, so kailangan panay yung sukat. going back to formula, we used x1000, if we didn't scale it, the x1000 will inflate the geometry of data. and the computation will fail.
            # standardization removes the effect of the multiplir x1000, giving a clean, unbiased measure of distance before it even start to cluster. 
            features = ['density']
            X = df[features]
            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X)

            # once standardized, we can now cluster the data into 3 clusters. if there are only 2 unique densities, we will just cluster into 2 clusters. if there is only 1 unique density, we will just cluster into 1 cluster.
            # instead of hardcoding 3 clusters, we will dynamically set the number of clusters based on the number of unique densities. this will prevent sklearn from crashing when there are fewer than 3 unique densities.
            n_clusters = min(3, unique_densities)
            # random_state=42 ensures reproducibility of results, n_init=10 means the algorithm will run 10 times with different centroid seeds and return the best output in terms of inertia.
            # interia: is the sum of squared distances of samples to their closest cluster center. lower inertia means better clustering. but since we are not using inertia to evaluate the model, we will just use the default value of 10 for n_init.
            # to avoid the local_minima problem, we will use n_init=10 to run the algorithm 10 times with different centroid seeds and return the best output in terms of inertia. this will ensure that we get the best clustering result possible.
            # kunwari nagbranch ka ng tatlong KFC (kanto fried chicken), that's the centroids. if we put them in one kanto at the start, maga-agawan sila ng customers. samantalang bakante naman yung ibang kanto sa ibang street. that's the local trap, na sinosolve naman ng kmeans
            kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
            labels = kmeans.fit_predict(X_scaled)
            df['cluster'] = labels
            
            # Calculate silhouette score for model confidence
            # silhouette score measures how similar an object is to its own cluster compared to other clusters. The score ranges from -1 to 1, where a higher value indicates better clustering. A score near 0 indicates overlapping clusters, and negative values indicate that samples may have been assigned to the wrong cluster.
            # silhouette score has cohesion and separtion.
            # Cohesion measures how close the points in a cluster are to each other. Separation measures how far apart the clusters are from each other. 
            # A good clustering algorithm should have high cohesion and high separation.
            
            # davies bouldin score is a metric for evaluating clustering algorithms. It is defined as the average similarity ratio of each cluster with its most similar cluster, where similarity is defined as the ratio of within-cluster distances to between-cluster distances. 
            # Lower values indicate better clustering.
            
            # calinski harabasz score is another metric for evaluating clustering algorithms. It is defined as the ratio of the sum of between-cluster dispersion to the sum of within-cluster dispersion.
            # variance ratio criterion. Higher values indicate better clustering.
            # for example, if we have 3 clusters, and the points in each cluster are very close to each other, and the clusters are very far apart from each other, then the calinski harabasz score will be high. but if the points in each cluster are very far from each other, and the clusters are very close to each other, then the calinski harabasz score will be low.
            if len(df) >= 3 and n_clusters >= 2:
                try:
                    silhouette_val = silhouette_score(X_scaled, labels)
                    davies_bouldin_val = davies_bouldin_score(X_scaled, labels)
                    calinski_harabasz_val = calinski_harabasz_score(X_scaled, labels)
                # if any of the metrics fail to compute (e.g., due to numerical issues), we will catch the exception and set the scores to 0.0 as a fallback.
                # if there is an error on the validation metrics, the dahsboard will be corrupted and the workflow will stop. making the clients(toda operators), tigil pasada since the system will be offline.
                except Exception:
                    silhouette_val = 0.0
                    davies_bouldin_val = 0.0
                    calinski_harabasz_val = 0.0
            
            #severity mapping, since kmeans algorithm ay walang pakialam sa mga pangalan, random lang kung ano ang iflag nya asa green, orange, red. that's label flipping.
            # so we will map the cluster labels to severity levels based on the average density of each cluster. the cluster with the lowest average density will be mapped to severity 0 (GREEN), the cluster with the second lowest average density will be mapped to severity 1 (YELLOW), and the cluster with the highest average density will be mapped to severity 2 (RED).
            # compute the average density for each cluster and sort them to determine the severity mapping. This ensures that the severity levels are assigned in a consistent manner based on the actual density values, rather than the arbitrary cluster labels assigned by KMeans.
            cluster_densities = df.groupby('cluster')['density'].mean().sort_values()
            ranking_map = {cluster_id: rank for rank, (cluster_id, _) in enumerate(cluster_densities.items())}
            df['severity'] = df['cluster'].map(ranking_map)
        
        target_data = df[df['route'] == target_route]
        # Check if target_data is empty to avoid IndexError when accessing iloc[0]
        has_data = not target_data.empty
        clustered = bool(unique_densities >= 2 and len(df) >= 3)
        
        if target_data.empty:
            severity, fleet_val, pop_val, road_val, density_val = 0, 0, 5000, 5.0, 0
        else:
            target_info = target_data.iloc[0]
            severity = int(target_info['severity'])
            fleet_val = int(target_info['fleet_size'])
            pop_val = int(target_info['population'])
            road_val = float(target_info['road_length'])
            density_val = float(target_info['density'])

        # 25010: Usability — simple words lang sa user-facing labels, walang jargon.
        # Pumo-prefix pa rin ng GREEN/YELLOW/RED para sa color mapping ng dashboard.
        # dictionary, json formatting 
        status_map = {
            0: "GREEN: Not full yet, can accept new operators", 
            1: "YELLOW: Almost full, keep watch", 
            2: "RED: Full, stop accepting new operators"
        }
        
        max_fleet = df['fleet_size'].max() or 1
        max_pop = df['population'].max() or 1
        max_road = df['road_length'].max() or 1
        
        importance_data = [
            {"factor": "Number of Active Operators", "weight": round((fleet_val / max_fleet) * 100, 1)},
            {"factor": "People in the Barangay", "weight": round((pop_val / max_pop) * 100, 1)},
            {"factor": "Road Length", "weight": round((road_val / max_road) * 100, 1)},
            {"factor": "Fullness Score", "weight": round(min(density_val * 10, 100), 1)}
        ]

        result = [{
            "forecast_period": status_map.get(severity, "GREEN: Not full yet — can accept new operators"), 
            "expected_renewals": fleet_val,  
            "model_confidence": f"Fullness Score: {round(density_val, 2)}",
            "silhouette": round(silhouette_val, 2),
            "davies_bouldin": round(davies_bouldin_val, 2),
            "calinski_harabasz": round(calinski_harabasz_val, 1),
            "has_demographic_data": has_data,
            # clustered=False means there were too few routes (or all densities
            # identical) to group anything — the three scores below are then
            # 0.0 placeholders, NOT real measurements, so the UI must not
            # color-grade them.
            "clustered": clustered,
            "feature_importances": importance_data,
            "historical_trend": [] 
        }]
        
        # Save to Cache
        _ML_CACHE[target_route] = result
        return result

    # Graceful degradation: If any unexpected error occurs, log the error and return an empty list to avoid crashing the entire application.
    # This ensures that the system remains operational even if the ML engine encounters an issue, allowing users to continue using other features of the application without interruption.    
    except Exception as e:
        print(f"ML Engine Crash: {e}")
        traceback.print_exc()
        return []