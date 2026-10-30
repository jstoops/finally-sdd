# Playwright runner for the FinAlly E2E suite (built by test/docker-compose.test.yml).
# The image tag must equal the exact @playwright/test version in package.json (1.64.1);
# the image ships the browsers but not the npm package, so npm ci installs it here.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /e2e
ENV CI=true

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

CMD ["npx", "playwright", "test"]
