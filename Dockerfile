# syntax=docker/dockerfile:1

# 1) Frontend bauen
FROM node:26-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json web/.npmrc ./
RUN npm ci
COPY api/ /src/api/
COPY web/ ./
RUN npm run build

# 2) Go-Binary mit eingebettetem Frontend bauen
FROM golang:1.26-alpine AS go
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
COPY --from=web /src/internal/web/dist/ internal/web/dist/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /kita-ausfall ./cmd/kita-ausfall

# 3) Minimales Laufzeit-Image: kein Shell, kein Paketmanager, läuft ohne Root
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=go /kita-ausfall /kita-ausfall
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/kita-ausfall"]
CMD ["serve"]
