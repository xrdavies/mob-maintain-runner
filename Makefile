# The runner as a LaunchAgent of the logged-in user (it uses this user's gh and codex logins).
LABEL := dev.mymob.maintain-runner
PLIST := $(HOME)/Library/LaunchAgents/$(LABEL).plist
DATA := $(HOME)/.mob-maintain-runner
# Proxy for GitHub and the agent: taken from the shell's https_proxy, or make install PROXY=... (PROXY= for none).
PROXY ?= $(or $(HTTPS_PROXY),$(https_proxy))

.PHONY: test install uninstall restart logs status

test:
	node --test test/*.test.mjs

install:
	mkdir -p $(DATA) $(HOME)/Library/LaunchAgents
	sed -e 's#@NODE@#$(shell command -v node)#' -e 's#@ROOT@#$(CURDIR)#g' -e 's#@DATA@#$(DATA)#g' \
	  -e 's#@PATH@#$(PATH)#' launchd/$(LABEL).plist > $(PLIST)
	if [ -n "$(PROXY)" ]; then for k in HTTPS_PROXY HTTP_PROXY https_proxy http_proxy; do plutil -insert EnvironmentVariables.$$k -string '$(PROXY)' $(PLIST); done; \
	  for k in NO_PROXY no_proxy; do plutil -insert EnvironmentVariables.$$k -string 'localhost,127.0.0.1' $(PLIST); done; fi
	-launchctl bootout gui/$$(id -u)/$(LABEL) 2>/dev/null
	launchctl bootstrap gui/$$(id -u) $(PLIST)
	@echo "installed; logs: make logs"

uninstall:
	-launchctl bootout gui/$$(id -u)/$(LABEL)
	rm -f $(PLIST)

restart:
	launchctl kickstart -k gui/$$(id -u)/$(LABEL)

logs:
	tail -f $(DATA)/runner.log

status:
	node bin/runner.mjs status
