#!/bin/bash

# run-nerd.sh - Start N.E.R.D. application in Local Mode (Full Sequence)

# Colors for output
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=========================================="
echo -e "      N.E.R.D. Local Mode Launcher"
echo -e "==========================================${NC}"

# Check for Python Environment
if [ ! -d "venv312" ]; then
    echo -e "${RED}Error: venv312 directory not found.${NC}"
    echo "Please create your virtual environment first."
    exit 1
fi

# Check for Frontend Dependencies
if [ ! -d "frontend/node_modules" ]; then
    echo -e "${YELLOW}Frontend dependencies missing. Running npm install...${NC}"
    cd frontend && npm install && cd ..
fi

# Check if ports are already in use and clean them up
if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${YELLOW}Port 8000 is in use. Cleaning up...${NC}"
    lsof -ti :8000 | xargs kill -9 2>/dev/null
    sleep 1
fi
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${YELLOW}Port 3000 is in use. Cleaning up...${NC}"
    lsof -ti :3000 | xargs kill -9 2>/dev/null
    sleep 1
fi

# Function to kill background processes on exit
cleanup() {
    echo -e "\n${BLUE}Stopping all N.E.R.D. services...${NC}"
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    echo -e "${GREEN}Done.${NC}"
    exit
}

trap cleanup SIGINT SIGTERM

echo -e "${YELLOW}Phase 1: Starting Backend (FastAPI)${NC}"
export PYTHONPATH=$PYTHONPATH:.
export LOCAL_MODE=true
source venv312/bin/activate
# Start uvicorn. Logs go to backend.log
uvicorn api.main:app --port 8000 --reload > backend.log 2>&1 &
BACKEND_PID=$!
echo -e "  - Backend PID: $BACKEND_PID"
echo -e "  - Logs: backend.log"

# Wait a moment for backend to initialize
sleep 2

echo -e "${YELLOW}Phase 2: Starting Frontend (Next.js)${NC}"
cd frontend
# Start Next.js. Logs go to frontend.log
npm run dev > ../frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..
echo -e "  - Frontend PID: $FRONTEND_PID"
echo -e "  - Logs: frontend.log"

echo -e "\n${GREEN}Success! N.E.R.D. is running in Local Mode.${NC}"
echo -e "${BLUE}------------------------------------------"
echo -e "Frontend: ${NC}http://localhost:3000"
echo -e "${BLUE}Backend:  ${NC}http://localhost:8000"
echo -e "${BLUE}------------------------------------------"

# Open the browser automatically (macOS/Darwin specific 'open')
if [[ "$OSTYPE" == "darwin"* ]]; then
    sleep 3 # Give Next.js a moment to start compiling
    open "http://localhost:3000"
fi

echo -e "To view logs: ${NC}tail -f frontend.log backend.log"
echo -e "${BLUE}To stop:      ${NC}Press Ctrl+C"
echo -e "${BLUE}------------------------------------------${NC}"

# Keep the script running to manage background processes
wait
