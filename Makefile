PYTHON ?= python3
THEME := theme/somnus-yohaku
LOCAL_THEME := content/themes/somnus-yohaku
SHARED_FONT_DIR := shared/fonts
LOCAL_FONT_DIR := content/images/fonts
LOCAL_PORT ?= 2369
LOCAL_URL ?= http://127.0.0.1:$(LOCAL_PORT)

.PHONY: theme check dev demo logs stop

theme:
	$(PYTHON) scripts/build_theme.py --theme $(THEME) --output build/somnus-yohaku.zip

check: theme
	$(PYTHON) scripts/check_theme.py
	PYTHONPYCACHEPREFIX=build/pycache $(PYTHON) -m py_compile scripts/*.py
	bash -n server/*.sh
	docker compose --env-file .env.example config --quiet

dev:
	mkdir -p $(LOCAL_THEME)
	rsync -a --delete $(THEME)/ $(LOCAL_THEME)/
	mkdir -p $(LOCAL_FONT_DIR)
	rsync -a $(SHARED_FONT_DIR)/ $(LOCAL_FONT_DIR)/
	docker network inspect proxy >/dev/null 2>&1 || docker network create proxy
	GHOST_URL=$(LOCAL_URL) GHOST_BIND_PORT=$(LOCAL_PORT) docker compose --env-file .env up -d mysql
	GHOST_URL=$(LOCAL_URL) GHOST_BIND_PORT=$(LOCAL_PORT) docker compose --env-file .env up -d --force-recreate ghost
	@echo "Local Ghost: $(LOCAL_URL)"

demo:
	$(PYTHON) scripts/seed_demo_content.py --url $(LOCAL_URL)

logs:
	docker compose logs -f ghost

stop:
	docker compose down
