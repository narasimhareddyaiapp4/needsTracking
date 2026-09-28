#!/bin/bash

# ==========================================
# SUPABASE EDGE FUNCTIONS DEPLOYMENT SCRIPT
# ==========================================

# Check if project ref is provided
if [ -z "$1" ]; then
    echo "Usage: ./deploy_functions.sh <NEW_PROJECT_REFERENCE_ID>"
    exit 1
fi

PROJECT_REF=$1

echo "🚀 Starting deployment of Edge Functions to project: $PROJECT_REF"

# List of functions to deploy (based on your supabase/functions directory)
FUNCTIONS=(
    "adjust-inventory"
    "assign-delivery-manager"
    "get-all-customers"
    "get-customers-by-location"
    "notify-new-product"
    "notify-order-update"
    "reset-inventory"
    "restock-inventory"
    "send-seller-order-notification"
    "send-stock-alert"
    "update-product-quantity"
    "upload-image"
)

for func in "${FUNCTIONS[@]}"; do
    echo "----------------------------------------"
    echo "📦 Deploying function: $func..."
    npx supabase functions deploy "$func" --project-ref "$PROJECT_REF"
done

echo "----------------------------------------"
echo "✅ All functions deployed successfully!"
echo "⚠️  Note: Remember to set your secrets using 'npx supabase secrets set KEY=VALUE'"
