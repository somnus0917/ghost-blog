PYTHON ?= python3
THEME := theme/somnus-yohaku
LOCAL_THEME := content/themes/somnus-yohaku
PERSISTENT_FONTS := shared/fonts/lxgw-wenkai-v2
LOCAL_FONTS := content/images/fonts/lxgw-wenkai-v2
LOCAL_PORT ?= 2369
LOCAL_URL ?= http://127.0.0.1:$(LOCAL_PORT)

.PHONY: assets theme font check e2e-up e2e-down e2e lighthouse smoke monitor verify-backup dev demo logs stop analytics-login analytics-tokens analytics-deploy

assets:
	npm run build:theme-assets

theme: assets
	$(PYTHON) scripts/build_theme.py --theme $(THEME) --output build/somnus-yohaku.zip

font:
	npm run prepare:font
	npm run build:font

check: theme
	$(PYTHON) scripts/check_theme.py
	PYTHONPYCACHEPREFIX=build/pycache $(PYTHON) -m py_compile scripts/*.py
	PYTHONPYCACHEPREFIX=build/pycache $(PYTHON) -m unittest discover -s scripts -p 'test_*.py'
	bash -n server/*.sh
	node --check scripts/build_theme_assets.mjs
	node --check scripts/build_webfont.mjs
	node --check $(THEME)/assets/js/main.js
	node --check $(THEME)/assets/js/latex-editor.js
	node --test worker/test/*.test.mjs
	docker compose --env-file .env.example config --quiet

e2e-up: theme
	mkdir -p build/e2e/content/settings
	rsync -a routes.yaml build/e2e/content/settings/routes.yaml
	docker compose -f docker-compose.e2e.yml up -d --wait --wait-timeout 120
	$(PYTHON) scripts/setup_e2e_ghost.py

e2e-down:
	docker compose -f docker-compose.e2e.yml down

e2e: e2e-up
	npm run test:e2e

lighthouse: e2e-up
	npm run test:lighthouse

smoke:
	bash server/smoke-production.sh

monitor:
	bash server/check-production.sh

verify-backup:
	bash server/verify-backup.sh

dev: assets
	mkdir -p $(LOCAL_THEME)
	rsync -a --delete $(THEME)/ $(LOCAL_THEME)/
	mkdir -p $(LOCAL_FONTS)
	rsync -a --delete $(PERSISTENT_FONTS)/ $(LOCAL_FONTS)/
	mkdir -p content/settings
	rsync -a routes.yaml content/settings/routes.yaml
	docker network inspect proxy >/dev/null 2>&1 || docker network create proxy
	GHOST_URL=$(LOCAL_URL) GHOST_BIND_PORT=$(LOCAL_PORT) docker compose --env-file .env up -d mysql
	GHOST_URL=$(LOCAL_URL) GHOST_BIND_PORT=$(LOCAL_PORT) docker compose --env-file .env up -d --force-recreate --wait --wait-timeout 120 ghost
	@echo "Local Ghost: $(LOCAL_URL)"

demo:
	$(PYTHON) scripts/seed_demo_content.py --url $(LOCAL_URL)

logs:
	docker compose logs -f ghost

stop:
	docker compose down

analytics-login:
	docker compose --profile analytics run --rm tinybird-login

analytics-tokens:
	docker compose --profile analytics run --rm tinybird-login get-tokens

analytics-deploy:
	docker compose --profile analytics run --rm tinybird-sync
	docker compose --profile analytics run --rm tinybird-deploy
