import time

import paramiko

from ..models import CommandResult, RiskLevel
from .redactor import redact_text


class SSHConnectionError(Exception):
    pass


class SSHRunner:
    def __init__(
        self,
        host: str,
        port: int,
        username: str,
        private_key_path: str,
        timeout_seconds: int = 30,
        max_output_chars: int = 12000,
    ):
        self._host = host
        self._port = port
        self._username = username
        self._private_key_path = private_key_path
        self._timeout_seconds = timeout_seconds
        self._max_output_chars = max_output_chars
        self._client: paramiko.SSHClient | None = None

    def _load_key(self) -> paramiko.PKey:
        key_classes = [
            paramiko.RSAKey,
            paramiko.Ed25519Key,
            paramiko.ECDSAKey,
        ]
        last_exc: Exception | None = None
        for klass in key_classes:
            try:
                return klass.from_private_key_file(self._private_key_path)
            except Exception as e:
                last_exc = e
        raise SSHConnectionError(f"Cannot load private key from {self._private_key_path}: {last_exc}")

    def connect(self) -> None:
        try:
            pkey = self._load_key()
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client.connect(
                hostname=self._host,
                port=self._port,
                username=self._username,
                pkey=pkey,
                timeout=10,
                banner_timeout=15,
                auth_timeout=15,
            )
            self._client = client
        except SSHConnectionError:
            raise
        except paramiko.AuthenticationException as e:
            raise SSHConnectionError(f"SSH authentication failed for {self._username}@{self._host}: {e}")
        except paramiko.SSHException as e:
            raise SSHConnectionError(f"SSH error connecting to {self._host}:{self._port}: {e}")
        except OSError as e:
            raise SSHConnectionError(f"Network error connecting to {self._host}:{self._port}: {e}")

    def close(self) -> None:
        if self._client:
            try:
                self._client.close()
            except Exception:
                pass
            self._client = None

    @property
    def is_connected(self) -> bool:
        if not self._client:
            return False
        transport = self._client.get_transport()
        return transport is not None and transport.is_active()

    def run(self, command_id: str, command: str, risk: RiskLevel = RiskLevel.READ_ONLY) -> CommandResult:
        if not self._client:
            raise SSHConnectionError("Not connected. Call connect() first.")

        start = time.monotonic()
        timed_out = False
        raw_stdout = ""
        raw_stderr = ""
        exit_code = -1

        try:
            _, stdout_ch, stderr_ch = self._client.exec_command(
                command, timeout=self._timeout_seconds
            )
            raw_stdout = stdout_ch.read().decode("utf-8", errors="replace")
            raw_stderr = stderr_ch.read().decode("utf-8", errors="replace")
            exit_code = stdout_ch.channel.recv_exit_status()
        except Exception as e:
            msg = str(e).lower()
            if "timed out" in msg or "timeout" in msg:
                timed_out = True
                raw_stderr = f"Command timed out after {self._timeout_seconds}s"
            else:
                raw_stderr = str(e)

        duration = time.monotonic() - start

        # Truncate long output
        if len(raw_stdout) > self._max_output_chars:
            raw_stdout = raw_stdout[: self._max_output_chars] + "\n[OUTPUT TRUNCATED]"
        if len(raw_stderr) > self._max_output_chars:
            raw_stderr = raw_stderr[: self._max_output_chars] + "\n[OUTPUT TRUNCATED]"

        return CommandResult(
            id=command_id,
            command=command,
            stdout=redact_text(raw_stdout),
            stderr=redact_text(raw_stderr),
            exit_code=exit_code,
            timed_out=timed_out,
            duration_seconds=round(duration, 2),
            risk=risk,
            redacted=True,
        )
