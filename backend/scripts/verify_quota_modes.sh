#!/bin/bash
#
# Verify quota mode consistency across /login, /me, and /scan/analyze
#
# Usage:
#   export API_URL=https://your-api.onrender.com/api
#   export TEST_EMAIL=your@email.com
#   ./verify_quota_modes.sh
#
# Or with password directly (less secure):
#   TEST_PASSWORD=yourpass ./verify_quota_modes.sh
#

set -e

API_URL="${API_URL:-http://localhost:3000/api}"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           Quota Mode Verification Script                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "API: $API_URL"
echo ""

# Get credentials
if [ -z "$TEST_EMAIL" ]; then
  read -p "Email: " TEST_EMAIL
fi

if [ -z "$TEST_PASSWORD" ]; then
  read -s -p "Password: " TEST_PASSWORD
  echo ""
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "Step 1: Login"
echo "═══════════════════════════════════════════════════════════════"

LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")

# Check for error
if echo "$LOGIN_RESPONSE" | grep -q '"error"'; then
  echo "❌ Login failed:"
  echo "$LOGIN_RESPONSE" | jq .
  exit 1
fi

# Extract token
TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.accessToken')
if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo "❌ Failed to extract token"
  echo "$LOGIN_RESPONSE" | jq .
  exit 1
fi

echo "✅ Login successful"
echo ""
echo "Login quota response:"
echo "$LOGIN_RESPONSE" | jq '.quota'
echo ""
echo "quota.source: $(echo "$LOGIN_RESPONSE" | jq -r '.quota.source')"
echo "quota.scansLimit: $(echo "$LOGIN_RESPONSE" | jq -r '.quota.scansLimit')"
echo "quota.competitorScansLimit: $(echo "$LOGIN_RESPONSE" | jq -r '.quota.competitorScansLimit')"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "Step 2: Get /me"
echo "═══════════════════════════════════════════════════════════════"

ME_RESPONSE=$(curl -s "$API_URL/auth/me" \
  -H "Authorization: Bearer $TOKEN")

echo "/me quota response:"
echo "$ME_RESPONSE" | jq '.quota'
echo ""
echo "quota.source: $(echo "$ME_RESPONSE" | jq -r '.quota.source')"
echo "quota.scansLimit: $(echo "$ME_RESPONSE" | jq -r '.quota.scansLimit')"
echo "quota.competitorScansLimit: $(echo "$ME_RESPONSE" | jq -r '.quota.competitorScansLimit')"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "Summary"
echo "═══════════════════════════════════════════════════════════════"

LOGIN_SOURCE=$(echo "$LOGIN_RESPONSE" | jq -r '.quota.source')
ME_SOURCE=$(echo "$ME_RESPONSE" | jq -r '.quota.source')
LOGIN_LIMIT=$(echo "$LOGIN_RESPONSE" | jq -r '.quota.scansLimit')
ME_LIMIT=$(echo "$ME_RESPONSE" | jq -r '.quota.scansLimit')

echo "Endpoint       | source              | scansLimit"
echo "---------------|---------------------|------------"
echo "/login         | $LOGIN_SOURCE       | $LOGIN_LIMIT"
echo "/me            | $ME_SOURCE          | $ME_LIMIT"

echo ""
if [ "$LOGIN_SOURCE" = "$ME_SOURCE" ]; then
  echo "✅ Sources match: $LOGIN_SOURCE"
else
  echo "❌ Sources MISMATCH: login=$LOGIN_SOURCE, me=$ME_SOURCE"
fi

if [ "$LOGIN_LIMIT" = "$ME_LIMIT" ] && [ "$LOGIN_LIMIT" != "null" ]; then
  echo "✅ Limits match and are populated: $LOGIN_LIMIT"
else
  if [ "$LOGIN_LIMIT" = "null" ] || [ "$ME_LIMIT" = "null" ]; then
    echo "❌ Limits contain null values (login=$LOGIN_LIMIT, me=$ME_LIMIT)"
  else
    echo "❌ Limits MISMATCH: login=$LOGIN_LIMIT, me=$ME_LIMIT"
  fi
fi

echo ""
echo "Expected modes by flag config:"
echo "  READ=false, DUAL=false → source='legacy', limits populated"
echo "  READ=true,  DUAL=false → source='legacy_fallback', limits populated"
echo "  READ=true,  DUAL=true  → source='v2', limits from usage_events"
echo ""
echo "To test scan endpoint, run a scan and check response.quota"
