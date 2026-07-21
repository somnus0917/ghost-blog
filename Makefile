PYTHON ?= python3
THEME := theme/somnus-yohaku
LOCAL_THEME := content/themes/somnus-yohaku

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
	docker compose --env-file .env up -d
	docker compose restart ghost
	@echo "Local Ghost: http://127.0.0.1:2368"

logs:
	docker compose logs -f ghost

stop:
	docker compose down
