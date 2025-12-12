#!/bin/bash

echo "Setting up country-based access control..."

# Create webhook-api directory if it doesn't exist
mkdir -p webhook-api

# Download IP2Location database
echo "Please download the IP2Location database:"
echo "1. Visit: https://lite.ip2location.com/"
echo "2. Download IP2LOCATION-LITE-DB1.CSV.ZIP"
echo "3. Extract IP2LOCATION-LITE-DB1.CSV to webhook-api/ directory"
echo ""

# Check if database exists
if [ -f "webhook-api/IP2LOCATION-LITE-DB1.CSV" ]; then
    echo "✓ IP2Location database found"
else
    echo "✗ IP2Location database not found"
    echo "  Please download and extract the database file"
fi

# Check environment configuration
if [ -f "webhook-api/.env" ]; then
    if grep -q "BLOCKED_COUNTRIES" webhook-api/.env; then
        echo "✓ Country blocking configuration found"
    else
        echo "Adding BLOCKED_COUNTRIES to .env..."
        echo "" >> webhook-api/.env
        echo "# Country Blocking (comma-separated ISO country codes)" >> webhook-api/.env
        echo "BLOCKED_COUNTRIES=RU,KP,NG,CN,IR,SY,AF,MM,BY" >> webhook-api/.env
    fi
else
    echo "✗ .env file not found. Please copy .env.example to .env"
fi

echo ""
echo "Country blocking setup complete!"
echo "Restart your server to apply changes: docker compose restart webhook-api"
