#!/bin/bash

###############################################################################
# AWS Lambda Deployment Script
# 
# Usage: ./deploy.sh [FUNCTION_NAME] [AWS_REGION]
# 
# Environment Variables (optional):
#   - LAMBDA_FUNCTION: Lambda 함수명 (인자 또는 환경변수)
#   - AWS_REGION: AWS 리전 (기본값: ap-northeast-2)
#   - AWS_PROFILE: AWS CLI 프로필 (기본값: emart-architect-admin-sso-ps-463941703341)
#
# Examples:
#   ./deploy.sh sac-prd-comm-datadog-alarm-ld
#   LAMBDA_FUNCTION=sac-prd-comm-datadog-alarm-ld ./deploy.sh
#   AWS_PROFILE=my-profile ./deploy.sh datadog-teams-handler
###############################################################################

set -e

# 색상 출력용
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 설정값
LAMBDA_FUNCTION="${1:-${LAMBDA_FUNCTION:-sac-prd-comm-datadog-alarm-ld}}"
AWS_REGION="${2:-${AWS_REGION:-ap-northeast-2}}"
AWS_PROFILE="${AWS_PROFILE:-emart-architect-admin-sso-ps-463941703341}"
ZIP_FILE="lambda-deploy.zip"
TEMP_DIR="lambda-deploy"

# 유효성 검사

echo -e "${YELLOW}=== AWS Lambda Deployment ===${NC}"
echo "Function: $LAMBDA_FUNCTION"
echo "Region: $AWS_REGION"
echo "Profile: $AWS_PROFILE"
echo ""

# 1️⃣ 배포 디렉토리 준비
echo -e "${YELLOW}[1/4] Preparing deployment package...${NC}"
rm -rf "$TEMP_DIR" "$ZIP_FILE"
mkdir -p "$TEMP_DIR"

# 2️⃣ 필요한 파일 복사
echo -e "${YELLOW}[2/4] Copying application files...${NC}"
cp index.js cardBuilder.js "$TEMP_DIR/"
cp package.json "$TEMP_DIR/"
cp package-lock.json "$TEMP_DIR/" 2>/dev/null || true

# 3️⃣ node_modules 설치 (프로덕션 전용)
echo -e "${YELLOW}[3/4] Installing production dependencies...${NC}"
cd "$TEMP_DIR"
npm ci --production --no-audit
cd ..

# 4️⃣ ZIP 파일 생성
echo -e "${YELLOW}[4/4] Creating deployment package...${NC}"
cd "$TEMP_DIR"
zip -r ../"$ZIP_FILE" . -q
cd ..

ZIP_SIZE=$(du -h "$ZIP_FILE" | cut -f1)
echo -e "${GREEN}✓ Package created: $ZIP_FILE ($ZIP_SIZE)${NC}"
echo ""

# 5️⃣ AWS CLI 배포
echo -e "${YELLOW}Deploying to AWS Lambda...${NC}"

# AWS 자격증명 확인
if ! aws sts get-caller-identity --profile "$AWS_PROFILE" &>/dev/null; then
  echo -e "${RED}Error: Cannot access AWS with profile '$AWS_PROFILE'${NC}"
  echo "Please configure AWS CLI: aws configure --profile $AWS_PROFILE"
  exit 1
fi

# Lambda 함수 업데이트
echo "Updating Lambda function: $LAMBDA_FUNCTION"
aws lambda update-function-code \
  --function-name "$LAMBDA_FUNCTION" \
  --zip-file "fileb://$ZIP_FILE" \
  --region "$AWS_REGION" \
  --profile "$AWS_PROFILE" \
  --query '{FunctionName: FunctionName, LastModified: LastModified, CodeSha256: CodeSha256}' --output json || {
    echo -e "${RED}Error: Lambda function update failed${NC}"
    exit 1
  }

# 함수 업데이트 완료 대기
echo "Waiting for function update to complete..."
aws lambda wait function-updated \
  --function-name "$LAMBDA_FUNCTION" \
  --region "$AWS_REGION" \
  --profile "$AWS_PROFILE" || {
    echo -e "${YELLOW}Warning: Wait timed out, but proceeding...${NC}"
  }

# 런타임 업데이트 (nodejs22.x)
echo "Updating Lambda function runtime to nodejs22.x..."
aws lambda update-function-configuration \
  --function-name "$LAMBDA_FUNCTION" \
  --runtime nodejs22.x \
  --region "$AWS_REGION" \
  --profile "$AWS_PROFILE" \
  --query '{FunctionName: FunctionName, LastModified: LastModified, CodeSha256: CodeSha256}' --output json || {
    echo -e "${RED}Error: Runtime update failed${NC}"
    exit 1
  }

echo ""
echo -e "${GREEN}✓ Deployment completed successfully!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Check function status: aws lambda get-function --function-name $LAMBDA_FUNCTION --region $AWS_REGION --profile $AWS_PROFILE"
echo "2. Check recent logs: aws logs tail /aws/lambda/$LAMBDA_FUNCTION --follow --region $AWS_REGION --profile $AWS_PROFILE"
echo ""

# 정리
rm -rf "$TEMP_DIR"
echo -e "${GREEN}Temporary files cleaned up${NC}"
