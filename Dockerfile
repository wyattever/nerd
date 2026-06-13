# Use an official Python runtime as a parent image
FROM python:3.12-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements and constraints files into the container at /app
COPY requirements.txt constraints.txt ./

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code into the container
COPY . .

# Expose the port Streamlit will run on
EXPOSE 8080

# Run the Streamlit app
CMD ["streamlit", "run", "app.py", "--server.port=8080", "--server.address=0.0.0.0"]
