# Kita-Ausfall NRW – Entwicklungsbefehle
# Lokale Datenbank: PostgreSQL ≥ 16 mit Rollen kita_migrate/kita_app (siehe README.md)

TEST_DATABASE_URL ?= postgres://kita_migrate:dev@localhost:5432/kita_test?sslmode=disable
DATABASE_URL      ?= postgres://kita_app:dev@localhost:5432/kita?sslmode=disable
MIGRATE_DATABASE_URL ?= postgres://kita_migrate:dev@localhost:5432/kita?sslmode=disable
E2E_PORT          ?= 8099
BIN               := bin/kita-ausfall

export DATABASE_URL MIGRATE_DATABASE_URL

.PHONY: build web go generate test test-go test-web lint e2e dev seed

build: web go

web:
	cd web && npm ci && npm run build

go:
	CGO_ENABLED=0 go build -trimpath -o $(BIN) ./cmd/kita-ausfall

generate:
	go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.30.0 generate
	cd web && npm run gen:api

test: test-go test-web

test-go:
	TEST_DATABASE_URL="$(TEST_DATABASE_URL)" go test -race ./...

test-web:
	cd web && npm test

lint:
	go vet ./...
	go run honnef.co/go/tools/cmd/staticcheck@v0.8.2 ./...
	go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...
	go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.30.0 diff
	cd web && npm run typecheck && npm run check:no-html

# Entwicklungsserver mit Testdaten (Frontend vorher bauen: make web)
dev: seed
	$(BIN) serve

seed: go
	$(BIN) migrate
	DATABASE_URL="$(MIGRATE_DATABASE_URL)" $(BIN) import --quelle testdaten --datei testdata/beispiel-kitas.csv --modus primaer

# Ende-zu-Ende-Tests (Playwright, Handy-Profile) gegen den echten Server in einem eigenen Schema
e2e: build
	psql "$(TEST_DATABASE_URL)" -q -c 'DROP SCHEMA IF EXISTS e2e CASCADE; CREATE SCHEMA e2e'
	@set -e; URL="$(TEST_DATABASE_URL)&search_path=e2e,public"; \
	export MIGRATE_DATABASE_URL="$$URL"; \
	DATABASE_URL="$$URL" $(BIN) migrate; \
	DATABASE_URL="$$URL" $(BIN) import --quelle testdaten --datei testdata/beispiel-kitas.csv --modus primaer >/dev/null; \
	DATABASE_URL="$$URL" ADDR=":$(E2E_PORT)" $(BIN) serve > /tmp/kita-e2e.log 2>&1 & PID=$$!; \
	trap "kill $$PID" EXIT; \
	for i in $$(seq 1 50); do curl -sf -o /dev/null http://localhost:$(E2E_PORT)/healthz && break; sleep 0.2; done; \
	cd web && E2E_BASE_URL=http://localhost:$(E2E_PORT) npx playwright test
