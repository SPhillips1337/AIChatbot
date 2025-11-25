#!/bin/bash

# PHPaibot Setup Script
echo "Setting up PHPaibot..."

# Create necessary directories
echo "Creating directories..."
mkdir -p docker/data/qdrant
mkdir -p docker/data/models
mkdir -p docker/data/embeddings
# Skipping n8n data directory creation (n8n workflows archived)
# mkdir -p docker/data/n8n
mkdir -p webhook-api/thoughts

# Check if GoogleNews vectors file exists
if [ -f "GoogleNews-vectors-negative300.bin.gz" ]; then
    echo "GoogleNews vectors file found."
else
    echo "Warning: GoogleNews-vectors-negative300.bin.gz not found."
    echo "Please download it from https://code.google.com/archive/p/word2vec/ and place it in the project root."
fi

# Check if Docker is installed
if command -v docker &> /dev/null; then
    echo "Docker is installed."
else
    echo "Warning: Docker is not installed. Please install Docker and Docker Compose."
    echo "Visit https://docs.docker.com/get-docker/ for installation instructions."
fi

# Check if Docker Compose is installed
if command -v docker-compose &> /dev/null; then
    echo "Docker Compose is installed."
else
    echo "Warning: Docker Compose is not installed. Please install Docker Compose."
    echo "Visit https://docs.docker.com/compose/install/ for installation instructions."
fi

echo "Setup complete. You can now start the services with 'docker-compose up -d'"
echo "Access the web interface at http://localhost:8000"
echo "Access the N8N workflow editor at http://localhost:5678"
echo "Access the Qdrant UI at http://localhost:6333/dashboard"
