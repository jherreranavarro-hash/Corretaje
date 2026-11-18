#!/bin/sh
# Crea el rol de la aplicación SIN privilegios de superusuario (necesario para que el aislamiento por empresa, RLS, se aplique)
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" <<SQL
CREATE ROLE corretaje LOGIN PASSWORD '$APP_DB_PASSWORD';
CREATE DATABASE corretaje OWNER corretaje;
SQL
