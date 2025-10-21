#!/usr/bin/env python3
"""
Probing Script for Recommendation API
Runs periodically to test the recommendation API and track performance
"""

import requests
import json
import time
import random
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import os

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class RecommendationProbe:
    def __init__(self, api_base_url: str, kafka_config: Optional[Dict] = None):
        self.api_base_url = api_base_url.rstrip('/')
        self.kafka_config = kafka_config or {}
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'User-Agent': 'RideEase-Probe/1.0'
        })
        
        # Test users for probing
        self.test_users = [
            'user_001', 'user_002', 'user_003', 'user_004', 'user_005',
            'user_006', 'user_007', 'user_008', 'user_009', 'user_010'
        ]
        
        # Test items for tracking interactions
        self.test_items = [
            'ride_001', 'ride_002', 'ride_003', 'ride_004', 'ride_005',
            'ride_006', 'ride_007', 'ride_008', 'ride_009', 'ride_010'
        ]

    def health_check(self) -> Dict:
        """Check API health status"""
        try:
            response = self.session.get(f"{self.api_base_url}/health", timeout=10)
            response.raise_for_status()
            
            health_data = response.json()
            logger.info(f"Health check passed: {health_data}")
            return {
                'status': 'healthy',
                'response_time': response.elapsed.total_seconds(),
                'data': health_data
            }
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return {
                'status': 'unhealthy',
                'error': str(e),
                'response_time': None
            }

    def get_recommendations(self, user_id: str, options: Dict = None) -> Dict:
        """Get recommendations for a user"""
        try:
            payload = {
                'userId': user_id,
                'options': options or {}
            }
            
            start_time = time.time()
            response = self.session.post(
                f"{self.api_base_url}/recommend", 
                json=payload,
                timeout=30
            )
            response_time = time.time() - start_time
            response.raise_for_status()
            
            data = response.json()
            
            result = {
                'status': 'success',
                'response_time': response_time,
                'recommendations_count': len(data.get('recommendations', [])),
                'model_used': data.get('model', 'unknown'),
                'request_id': data.get('requestId', 'unknown'),
                'latency': data.get('latency', 0),
                'data': data
            }
            
            logger.info(f"Recommendations for {user_id}: {result['recommendations_count']} items")
            return result
            
        except Exception as e:
            logger.error(f"Recommendation request failed for {user_id}: {e}")
            return {
                'status': 'error',
                'error': str(e),
                'response_time': None,
                'recommendations_count': 0
            }

    def track_interaction(self, user_id: str, item_id: str, interaction_type: str = 'view') -> Dict:
        """Track user interaction"""
        try:
            payload = {
                'userId': user_id,
                'itemId': item_id,
                'interactionType': interaction_type,
                'metadata': {
                    'source': 'probe',
                    'timestamp': datetime.now().isoformat()
                }
            }
            
            response = self.session.post(
                f"{self.api_base_url}/track",
                json=payload,
                timeout=10
            )
            response.raise_for_status()
            
            data = response.json()
            logger.info(f"Tracked {interaction_type} for user {user_id}, item {item_id}")
            
            return {
                'status': 'success',
                'interaction': data.get('interaction', {}),
                'response_time': response.elapsed.total_seconds()
            }
            
        except Exception as e:
            logger.error(f"Tracking failed for user {user_id}, item {item_id}: {e}")
            return {
                'status': 'error',
                'error': str(e)
            }

    def compare_models(self, user_id: str) -> Dict:
        """Compare all available models"""
        try:
            payload = {
                'userId': user_id,
                'options': {'numRecommendations': 5}
            }
            
            response = self.session.post(
                f"{self.api_base_url}/models/compare",
                json=payload,
                timeout=60
            )
            response.raise_for_status()
            
            data = response.json()
            
            comparison_result = {
                'status': 'success',
                'models_compared': len(data.get('comparison', {})),
                'total_time': data.get('totalComparisonTime', 0),
                'data': data
            }
            
            logger.info(f"Model comparison completed for {user_id}: {comparison_result['models_compared']} models")
            return comparison_result
            
        except Exception as e:
            logger.error(f"Model comparison failed for {user_id}: {e}")
            return {
                'status': 'error',
                'error': str(e)
            }

    def run_probe_cycle(self) -> Dict:
        """Run a complete probe cycle"""
        logger.info("Starting probe cycle...")
        
        cycle_start = time.time()
        results = {
            'cycle_start': datetime.now().isoformat(),
            'health_check': {},
            'recommendations': [],
            'interactions': [],
            'model_comparison': {},
            'summary': {}
        }
        
        # 1. Health check
        results['health_check'] = self.health_check()
        
        if results['health_check']['status'] != 'healthy':
            logger.error("API is unhealthy, skipping other tests")
            results['summary'] = {
                'status': 'failed',
                'reason': 'API unhealthy'
            }
            return results
        
        # 2. Test recommendations for multiple users
        test_users = random.sample(self.test_users, min(5, len(self.test_users)))
        recommendation_results = []
        
        for user_id in test_users:
            # Get recommendations
            rec_result = self.get_recommendations(user_id, {
                'numRecommendations': 10,
                'context': {
                    'location': random.choice(['NYC', 'SF', 'LA', 'Chicago']),
                    'timeOfDay': random.choice(['morning', 'afternoon', 'evening'])
                }
            })
            recommendation_results.append({
                'user_id': user_id,
                'result': rec_result
            })
            
            # Track some interactions
            if rec_result['status'] == 'success' and rec_result['recommendations_count'] > 0:
                recommendations = rec_result['data'].get('recommendations', [])
                if recommendations:
                    # Simulate user viewing first recommendation
                    item_id = recommendations[0].get('itemId', random.choice(self.test_items))
                    interaction_result = self.track_interaction(user_id, item_id, 'view')
                    results['interactions'].append({
                        'user_id': user_id,
                        'item_id': item_id,
                        'result': interaction_result
                    })
                    
                    # Simulate rating some items
                    if random.random() > 0.7:  # 30% chance of rating
                        rating = random.randint(1, 5)
                        interaction_result = self.track_interaction(user_id, item_id, 'rate')
                        results['interactions'].append({
                            'user_id': user_id,
                            'item_id': item_id,
                            'rating': rating,
                            'result': interaction_result
                        })
            
            time.sleep(0.1)  # Small delay between requests
        
        results['recommendations'] = recommendation_results
        
        # 3. Model comparison for one user
        comparison_user = random.choice(test_users)
        results['model_comparison'] = self.compare_models(comparison_user)
        
        # 4. Generate summary
        cycle_time = time.time() - cycle_start
        successful_recommendations = sum(1 for r in recommendation_results 
                                       if r['result']['status'] == 'success')
        personalized_responses = sum(1 for r in recommendation_results 
                                   if r['result']['status'] == 'success' and 
                                   r['result']['recommendations_count'] > 0)
        
        results['summary'] = {
            'status': 'completed',
            'cycle_time': cycle_time,
            'total_requests': len(recommendation_results) + 1,  # +1 for model comparison
            'successful_recommendations': successful_recommendations,
            'personalized_responses': personalized_responses,
            'personalization_rate': personalized_responses / len(recommendation_results) if recommendation_results else 0,
            'avg_response_time': sum(r['result']['response_time'] for r in recommendation_results 
                                   if r['result']['response_time']) / len(recommendation_results) if recommendation_results else 0
        }
        
        logger.info(f"Probe cycle completed in {cycle_time:.2f}s")
        logger.info(f"Personalization rate: {results['summary']['personalization_rate']:.2%}")
        
        return results

    def run_continuous_probe(self, interval_minutes: int = 15, duration_hours: int = 24):
        """Run continuous probing for specified duration"""
        logger.info(f"Starting continuous probe: {interval_minutes}min intervals for {duration_hours}h")
        
        end_time = datetime.now() + timedelta(hours=duration_hours)
        cycle_count = 0
        
        while datetime.now() < end_time:
            try:
                cycle_count += 1
                logger.info(f"Starting probe cycle #{cycle_count}")
                
                results = self.run_probe_cycle()
                
                # Save results to file
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"probe_results_{timestamp}.json"
                
                with open(filename, 'w') as f:
                    json.dump(results, f, indent=2)
                
                logger.info(f"Results saved to {filename}")
                
                # Wait for next cycle
                if datetime.now() < end_time:
                    sleep_seconds = interval_minutes * 60
                    logger.info(f"Sleeping for {interval_minutes} minutes...")
                    time.sleep(sleep_seconds)
                
            except KeyboardInterrupt:
                logger.info("Probing interrupted by user")
                break
            except Exception as e:
                logger.error(f"Error in probe cycle #{cycle_count}: {e}")
                time.sleep(60)  # Wait 1 minute before retrying
        
        logger.info(f"Continuous probing completed. Total cycles: {cycle_count}")

def main():
    """Main function for running the probe"""
    import argparse
    
    parser = argparse.ArgumentParser(description='RideEase Recommendation API Probe')
    parser.add_argument('--api-url', default='http://localhost:3000', 
                       help='API base URL')
    parser.add_argument('--interval', type=int, default=15,
                       help='Probe interval in minutes')
    parser.add_argument('--duration', type=int, default=24,
                       help='Probe duration in hours')
    parser.add_argument('--single', action='store_true',
                       help='Run single probe cycle instead of continuous')
    
    args = parser.parse_args()
    
    probe = RecommendationProbe(args.api_url)
    
    if args.single:
        results = probe.run_probe_cycle()
        print(json.dumps(results, indent=2))
    else:
        probe.run_continuous_probe(args.interval, args.duration)

if __name__ == '__main__':
    main()
