#!/bin/bash

# RideEase Recommendation System Setup Script
# This script sets up and verifies the complete recommendation system

set -e

echo "🚀 Setting up RideEase Recommendation System..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
KAFKA_BROKERS=${KAFKA_BROKERS:-"localhost:9092"}
API_URL=${API_URL:-"http://localhost:3000"}
TEAM_NAME="rideease"

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Step 1: Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if ! command_exists node; then
        log_error "Node.js is not installed. Please install Node.js 18 or later."
        exit 1
    fi
    
    if ! command_exists python3; then
        log_error "Python 3 is not installed. Please install Python 3."
        exit 1
    fi
    
    if ! command_exists docker; then
        log_warn "Docker is not installed. Docker setup will be skipped."
    fi
    
    log_info "Prerequisites check completed ✅"
}

# Step 2: Install dependencies
install_dependencies() {
    log_info "Installing Node.js dependencies..."
    npm install
    log_info "Dependencies installed ✅"
}

# Step 3: Setup Kafka topics
setup_kafka_topics() {
    log_info "Setting up Kafka topics..."
    
    # Check if kcat is available
    if ! command_exists kcat; then
        log_warn "kcat is not installed. Installing kcat..."
        if command_exists brew; then
            brew install kcat
        elif command_exists apt-get; then
            sudo apt-get update && sudo apt-get install -y kcat
        else
            log_error "Cannot install kcat automatically. Please install kcat manually."
            exit 1
        fi
    fi
    
    # Create topics
    log_info "Creating Kafka topics..."
    
    topics=("${TEAM_NAME}.watch" "${TEAM_NAME}.rate" "${TEAM_NAME}.reco_requests" "${TEAM_NAME}.reco_responses")
    
    for topic in "${topics[@]}"; do
        log_info "Creating topic: $topic"
        echo "$topic:1:1" | kcat -P -b "$KAFKA_BROKERS" -t "$topic" -K: || log_warn "Failed to create topic $topic"
    done
    
    log_info "Kafka topics setup completed ✅"
}

# Step 4: Verify Kafka topics
verify_kafka_topics() {
    log_info "Verifying Kafka topics..."
    
    log_info "Listing Kafka topics:"
    kcat -L -b "$KAFKA_BROKERS" || log_error "Failed to list Kafka topics"
    
    log_info "Testing topic connectivity:"
    echo "test message" | kcat -P -b "$KAFKA_BROKERS" -t "${TEAM_NAME}.watch" || log_error "Failed to publish test message"
    
    log_info "Kafka verification completed ✅"
}

# Step 5: Initialize and train models
setup_models() {
    log_info "Initializing and training recommendation models..."
    
    # Initialize system
    node index.js init
    
    # Train models
    node index.js train
    
    log_info "Models setup completed ✅"
}

# Step 6: Start the system
start_system() {
    log_info "Starting recommendation system..."
    
    # Start in background
    nohup node index.js start > recommender.log 2>&1 &
    SYSTEM_PID=$!
    echo $SYSTEM_PID > recommender.pid
    
    # Wait for system to start
    log_info "Waiting for system to start..."
    sleep 10
    
    # Check if system is running
    if ps -p $SYSTEM_PID > /dev/null; then
        log_info "Recommendation system started with PID $SYSTEM_PID ✅"
    else
        log_error "Failed to start recommendation system"
        exit 1
    fi
}

# Step 7: Verify API
verify_api() {
    log_info "Verifying API endpoints..."
    
    # Wait for API to be ready
    for i in {1..30}; do
        if curl -s "$API_URL/health" > /dev/null; then
            log_info "API is ready ✅"
            break
        fi
        if [ $i -eq 30 ]; then
            log_error "API failed to start"
            exit 1
        fi
        sleep 2
    done
    
    # Test health endpoint
    log_info "Testing health endpoint:"
    curl -s "$API_URL/health" | jq . || log_warn "Health endpoint test failed"
    
    # Test recommendation endpoint
    log_info "Testing recommendation endpoint:"
    curl -s -X POST "$API_URL/recommend" \
        -H "Content-Type: application/json" \
        -d '{"userId": "test_user", "options": {"numRecommendations": 5}}' | jq . || log_warn "Recommendation endpoint test failed"
    
    log_info "API verification completed ✅"
}

# Step 8: Run evaluation
run_evaluation() {
    log_info "Running model evaluation..."
    
    node index.js evaluate
    
    log_info "Evaluation completed ✅"
}

# Step 9: Setup probing
setup_probing() {
    log_info "Setting up probing system..."
    
    # Install Python dependencies
    if [ -f "requirements.txt" ]; then
        pip3 install -r requirements.txt
    fi
    
    # Create cron job for periodic probing
    log_info "Setting up cron job for periodic probing..."
    
    # Create probe script
    cat > probe_daily.sh << EOF
#!/bin/bash
cd "$(dirname "$0")"
python3 scripts/probe.py --api-url "$API_URL" --single >> probe_results.log 2>&1
EOF
    
    chmod +x probe_daily.sh
    
    # Add to crontab (runs every 15 minutes)
    (crontab -l 2>/dev/null; echo "*/15 * * * * $(pwd)/probe_daily.sh") | crontab - || log_warn "Failed to add cron job"
    
    log_info "Probing setup completed ✅"
}

# Step 10: Generate verification report
generate_report() {
    log_info "Generating verification report..."
    
    REPORT_FILE="verification_report_$(date +%Y%m%d_%H%M%S).md"
    
    cat > "$REPORT_FILE" << EOF
# RideEase Recommendation System Verification Report

Generated: $(date)

## System Configuration
- Team Name: $TEAM_NAME
- Kafka Brokers: $KAFKA_BROKERS
- API URL: $API_URL
- System PID: $(cat recommender.pid 2>/dev/null || echo "Not running")

## Kafka Topics Verification

### Topic List
\`\`\`
$(kcat -L -b "$KAFKA_BROKERS" 2>/dev/null || echo "Failed to list topics")
\`\`\`

### Topic Configuration
- ${TEAM_NAME}.watch: User interaction events
- ${TEAM_NAME}.rate: User rating events  
- ${TEAM_NAME}.reco_requests: Recommendation requests
- ${TEAM_NAME}.reco_responses: Recommendation responses

### kcat Test Output
\`\`\`
$(echo "test message" | kcat -P -b "$KAFKA_BROKERS" -t "${TEAM_NAME}.watch" -K: 2>&1 || echo "Test failed")
\`\`\`

## API Verification

### Health Check
\`\`\`json
$(curl -s "$API_URL/health" 2>/dev/null || echo "Health check failed")
\`\`\`

### Recommendation Test
\`\`\`json
$(curl -s -X POST "$API_URL/recommend" -H "Content-Type: application/json" -d '{"userId": "test_user"}' 2>/dev/null || echo "Recommendation test failed")
\`\`\`

## Model Information
\`\`\`json
$(curl -s "$API_URL/models" 2>/dev/null || echo "Models endpoint failed")
\`\`\`

## System Status
- System Running: $(ps -p $(cat recommender.pid 2>/dev/null) > /dev/null && echo "Yes" || echo "No")
- Log File: recommender.log
- Probe Results: probe_results.log

## Next Steps
1. Monitor system performance
2. Check probe results regularly
3. Review evaluation results
4. Scale as needed

EOF
    
    log_info "Verification report generated: $REPORT_FILE ✅"
}

# Step 11: Run comprehensive test
run_comprehensive_test() {
    log_info "Running comprehensive test suite..."
    
    node index.js test
    
    log_info "Comprehensive test completed ✅"
}

# Main execution
main() {
    echo "🚀 RideEase Recommendation System Setup"
    echo "======================================"
    
    check_prerequisites
    install_dependencies
    setup_kafka_topics
    verify_kafka_topics
    setup_models
    start_system
    verify_api
    run_evaluation
    setup_probing
    generate_report
    
    echo ""
    echo "🎉 Setup completed successfully!"
    echo ""
    echo "📊 System Information:"
    echo "  API URL: $API_URL"
    echo "  Health Check: $API_URL/health"
    echo "  Kafka Brokers: $KAFKA_BROKERS"
    echo "  Log File: recommender.log"
    echo "  PID File: recommender.pid"
    echo ""
    echo "🔍 Verification:"
    echo "  curl $API_URL/health"
    echo "  kcat -L -b $KAFKA_BROKERS"
    echo ""
    echo "📈 Monitoring:"
    echo "  tail -f recommender.log"
    echo "  tail -f probe_results.log"
    echo ""
    echo "🛑 Stop System:"
    echo "  kill \$(cat recommender.pid)"
    echo ""
}

# Handle command line arguments
case "${1:-setup}" in
    "setup")
        main
        ;;
    "verify")
        verify_kafka_topics
        verify_api
        generate_report
        ;;
    "test")
        run_comprehensive_test
        ;;
    "stop")
        if [ -f "recommender.pid" ]; then
            kill $(cat recommender.pid)
            rm recommender.pid
            log_info "System stopped ✅"
        else
            log_warn "System is not running"
        fi
        ;;
    "clean")
        log_info "Cleaning up..."
        rm -f recommender.pid recommender.log probe_results.log
        docker-compose down 2>/dev/null || true
        log_info "Cleanup completed ✅"
        ;;
    *)
        echo "Usage: $0 [setup|verify|test|stop|clean]"
        echo ""
        echo "Commands:"
        echo "  setup  - Complete system setup (default)"
        echo "  verify - Verify existing setup"
        echo "  test   - Run comprehensive tests"
        echo "  stop   - Stop the system"
        echo "  clean  - Clean up files and containers"
        exit 1
        ;;
esac
