import os
from google import genai

# Configuration
PROJECT_ID = "edtech-agent-2026"

def list_models(location):
    print(f"\n--- Checking Models in {location} ---")
    client = genai.Client(vertexai=True, project=PROJECT_ID, location=location)
    try:
        # Use the correct SDK method to list models
        models = client.models.list()
        for m in models:
            print(f"- {m.name}")
    except Exception as e:
        print(f"Error in {location}: {e}")

if __name__ == "__main__":
    for loc in ["us-central1", "us-east1", "us-west1"]:
        list_models(loc)
