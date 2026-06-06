from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-20250514"

    erp_base_url: str = ""
    erp_bearer_token: str = ""

    ssh_private_key_path: str = "./keys/id_rsa.pem"
    ssh_keys_dir: str = "./keys"
    ssh_default_user: str = "azureuser"

    command_timeout_seconds: int = 30
    max_command_output_chars: int = 12000


settings = Settings()
