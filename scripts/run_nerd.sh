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

# Function to check if a port is open
wait_for_port() {
    local port=$1
    local name=$2
    echo -n -e "${YELLOW}Waiting for $name (port $port)...${NC}"
    while ! lsof -Pi :$port -sTCP:LISTEN -t >/dev/null ; do
        sleep 1
        echo -n "."
    done
    echo -e " ${GREEN}READY${NC}"
}

# 1. Python Environment & Requirements
if [ ! -d "venv312" ]; then
    echo -e "${YELLOW}Creating virtual environment (venv312)...${NC}"
    python3.12 -m venv venv312
fi

source venv312/bin/activate
echo -e "${YELLOW}Verifying Python requirements...${NC}"
pip install -q -r requirements.txt
echo -e "  - ${GREEN}Python dependencies satisfied.${NC}"

# 2. Frontend Dependencies
if [ ! -d "frontend/node_modules" ]; then
    echo -e "${YELLOW}Frontend dependencies missing. Running npm install...${NC}"
    cd frontend && npm install && cd ..
fi

# 3. Cleanup stale processes
if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${YELLOW}Port 8000 is in use. Cleaning up...${NC}"
    lsof -ti :8000 | xargs kill -9 2>/dev/null
fi
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${YELLOW}Port 3000 is in use. Cleaning up...${NC}"
    lsof -ti :3000 | xargs kill -9 2>/dev/null
fi

# Function to kill background processes on exit
cleanup() {
    echo -e "\n${BLUE}Stopping all N.E.R.D. services...${NC}"
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    echo -e "${GREEN}Done.${NC}"
    exit
}

trap cleanup SIGINT SIGTERM

# 4. Start Backend
echo -e "${YELLOW}Phase 1: Starting Backend (FastAPI)${NC}"
export PYTHONPATH=$PYTHONPATH:.
export LOCAL_MODE=true
# Start uvicorn. Logs go to backend.log
uvicorn api.main:app --port 8000 --reload > backend.log 2>&1 &
BACKEND_PID=$!
echo -e "  - Backend PID: $BACKEND_PID"
echo -e "  - Logs: backend.log"

# Wait for backend to be ready
wait_for_port 8000 "Backend"

# 5. Start Frontend
echo -e "${YELLOW}Phase 2: Starting Frontend (Next.js)${NC}"
cd frontend
# Start Next.js. Logs go to frontend.log
npm run dev > ../frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..
echo -e "  - Frontend PID: $FRONTEND_PID"
echo -e "  - Logs: frontend.log"

# Wait for frontend to be ready
wait_for_port 3000 "Frontend"

echo -e "\n${GREEN}Success! N.E.R.D. is running in Local Mode.${NC}"
echo -e "${BLUE}------------------------------------------"
echo -e "Frontend: ${NC}http://localhost:3000"
echo -e "${BLUE}Backend:  ${NC}http://localhost:8000"
echo -e "${BLUE}------------------------------------------"

# 6. Open Browser
URL="http://localhost:3000"
if [[ "$OSTYPE" == "darwin"* ]]; then
    open "$URL"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    if command -v xdg-open > /dev/null; then
        xdg-open "$URL"
    else
        echo -e "${YELLOW}Please open $URL manually.${NC}"
    fi
fi

echo -e "To view logs: ${NC}tail -f frontend.log backend.log"
echo -e "${BLUE}To stop:      ${NC}Press Ctrl+C"
echo -e "${BLUE}------------------------------------------${NC}"

# Keep the script running to manage background processes
wait
