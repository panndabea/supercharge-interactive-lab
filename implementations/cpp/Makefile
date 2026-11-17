ifeq ($(origin CXX),default)
CXX = g++-13
endif
CXXFLAGS ?= -std=c++23 -O2 -Wall -Wextra -Wpedantic -Werror -Iinclude
BUILD := build

all: $(BUILD)/supercharge $(BUILD)/conformance

$(BUILD)/supercharge: src/main.cpp include/supercharge.hpp | $(BUILD)
	$(CXX) $(CXXFLAGS) $< -o $@

$(BUILD)/conformance: tests/conformance.cpp include/supercharge.hpp | $(BUILD)
	$(CXX) $(CXXFLAGS) $< -o $@

$(BUILD):
	mkdir -p $@

test: $(BUILD)/conformance
	./$(BUILD)/conformance ../../fixtures

clean:
	rm -rf $(BUILD)

.PHONY: all test clean
