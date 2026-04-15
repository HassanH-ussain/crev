"""
Configuration management for CREV.

Loads settings from (in priority order):
    1. CLI flags (highest)
    2. Environment variables
    3. ~/.crev/config.json
    4. Built-in defaults (lowest)
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

CONFIG_DIR = Path.home() / ".crev"
CONFIG_FILE = CONFIG_DIR / "config.json"
CACHE_DIR = CONFIG_DIR / "cache"

DEFAULT_MODEL = "claude-sonnet-4-20250514"
DEFAULT_MAX_TOKENS = 4096
DEFAULT_DEPTH = "standard"
MAX_FILE_SIZE_KB = 500


@dataclass
class CrevConfig:
    """Resolved configuration for a CREV session."""

    api_key: str = ""
    model: str = DEFAULT_MODEL
    max_tokens: int = DEFAULT_MAX_TOKENS
    depth: str = DEFAULT_DEPTH
    max_file_size_kb: int = MAX_FILE_SIZE_KB
    cache_enabled: bool = True
    color_enabled: bool = True
    custom_rules: dict[str, Any] = field(default_factory=dict)

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    def depth_prompt_modifier(self) -> str:
        modifiers = {
            "quick": "Focus only on critical bugs and security issues. Be very concise.",
            "standard": (
                "Cover bugs, performance issues, security concerns, and major style problems. "
                "Provide actionable suggestions."
            ),
            "full": (
                "Perform an exhaustive review covering bugs, security, performance, "
                "style, naming conventions, documentation, error handling, edge cases, "
                "and architectural concerns. Be thorough and detailed."
            ),
        }
        return modifiers.get(self.depth, modifiers["standard"])


def _ensure_dirs() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def load_config(
    api_key: str | None = None,
    depth: str | None = None,
    model: str | None = None,
) -> CrevConfig:
    """Build a CrevConfig by merging all configuration sources."""
    load_dotenv()
    _ensure_dirs()

    config = CrevConfig()

    # Layer 2: Config file
    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text())
            for key, value in data.items():
                if hasattr(config, key):
                    setattr(config, key, value)
        except (json.JSONDecodeError, OSError):
            pass

    # Layer 3: Environment variables
    env_key = os.getenv("ANTHROPIC_API_KEY") or os.getenv("CREV_API_KEY")
    if env_key:
        config.api_key = env_key

    env_model = os.getenv("CREV_MODEL")
    if env_model:
        config.model = env_model

    # Layer 4: CLI overrides (highest priority)
    if api_key:
        config.api_key = api_key
    if depth:
        config.depth = depth
    if model:
        config.model = model

    return config


def save_config(key: str, value: str) -> None:
    """Persist a single config key to the config file."""
    _ensure_dirs()

    data: dict[str, Any] = {}
    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            data = {}

    data[key] = value
    CONFIG_FILE.write_text(json.dumps(data, indent=2) + "\n")
