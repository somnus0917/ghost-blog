PYTHON ?= python3
THEME := theme/somnus-yohaku
LOCAL_THEME := content/themes/somnus-yohaku
LOCAL_PORT ?= 2369

.PHONY: theme check dev logs stop

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
	docker network inspect proxy >/dev/null 2>&1 || docker network create proxy
	GHOST_BIND_PORT=$(LOCAL_PORT) docker compose --env-file .env up -d mysql
	GHOST_BIND_PORT=$(LOCAL_PORT) docker compose --env-file .env up -d --force-recreate ghost
	@echo "Local Ghost: http://127.0.0.1:$(LOCAL_PORT)"

logs:
	docker compose logs -f ghost

stop:
	docker compose down
