# The runner as a LaunchAgent of the logged-in user (it uses this user's gh and codex logins).
LABEL := dev.mymob.maintain-runner
PLIST := $(HOME)/Library/LaunchAgents/$(LABEL).plist
DATA := $(HOME)/.mob-maintain-runner

.PHONY: test install uninstall restart logs status

test:
	node --test test/*.test.mjs

install:
	mkdir -p $(DATA) $(HOME)/Library/LaunchAgents
	sed -e 's#@NODE@#$(shell command -v node)#' -e 's#@ROOT@#$(CURDIR)#g' -e 's#@DATA@#$(DATA)#g' \
	  -e 's#@PATH@#$(PATH)#' launchd/$(LABEL).plist > $(PLIST)
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
