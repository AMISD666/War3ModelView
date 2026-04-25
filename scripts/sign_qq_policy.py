#!/usr/bin/env python3
"""
Generate the signed remote QQ activation policy text.

The output is the exact single-line content expected by activation/qq-policy.txt:
base64(json_payload).base64(ed25519_signature)
"""

import argparse
import base64
import json
from datetime import datetime
from pathlib import Path

from nacl.signing import SigningKey


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PRIVATE_KEY = REPO_ROOT / "keygen" / "private.key"


def parse_bool(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on", "enable", "enabled"}:
        return True
    if normalized in {"0", "false", "no", "off", "disable", "disabled"}:
        return False
    raise argparse.ArgumentTypeError("enabled must be true or false")


def load_signing_key(path: Path) -> SigningKey:
    private_b64 = path.read_text(encoding="utf-8").strip()
    return SigningKey(base64.b64decode(private_b64))


def build_signed_policy(
    signing_key: SigningKey,
    enabled: bool,
    policy_version: int,
    message: str | None,
) -> str:
    policy_message = message
    if policy_message is None:
        policy_message = "" if enabled else "QQ群成员验证已暂停，请使用激活码激活"

    payload = {
        "schema": 1,
        "policyVersion": policy_version,
        "qqActivationEnabled": enabled,
        "message": policy_message,
        "iss": "War3ModelEditor",
    }
    payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    signature = signing_key.sign(payload_json).signature
    return f"{base64.b64encode(payload_json).decode()}.{base64.b64encode(signature).decode()}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Sign the remote QQ activation policy.")
    parser.add_argument(
        "--enabled",
        required=True,
        type=parse_bool,
        help="true to allow QQ activation, false to disable it",
    )
    parser.add_argument(
        "--version",
        default=int(datetime.now().strftime("%Y%m%d%H%M%S")),
        type=int,
        help="policy version; defaults to current timestamp",
    )
    parser.add_argument(
        "--message",
        default=None,
        help="message shown when QQ activation is disabled",
    )
    parser.add_argument(
        "--private-key",
        default=str(DEFAULT_PRIVATE_KEY),
        help="path to the base64 Ed25519 private key",
    )
    parser.add_argument(
        "--output",
        help="optional output file; if omitted, prints to stdout",
    )
    args = parser.parse_args()

    signing_key = load_signing_key(Path(args.private_key))
    signed_policy = build_signed_policy(signing_key, args.enabled, args.version, args.message)

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(signed_policy + "\n", encoding="utf-8")
        state = "开启" if args.enabled else "关闭"
        print(f"已生成{state}Q群验证策略: {output_path} (version {args.version})")
    else:
        print(signed_policy)


if __name__ == "__main__":
    main()
