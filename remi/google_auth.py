"""הרצה חד-פעמית לחיבור חשבון Google (יומן + Gmail).

לפני ההרצה: להוריד credentials.json (OAuth Desktop App) מ-Google Cloud Console
ולשים אותו בתיקייה הזו. ההרצה תפתח דפדפן לאישור ותשמור token.json.
"""
from google_auth_oauthlib.flow import InstalledAppFlow

import config


def main() -> None:
    if not config.GOOGLE_CREDENTIALS_PATH.exists():
        raise SystemExit(
            "לא נמצא credentials.json.\n"
            "הורד אותו מ-Google Cloud Console (OAuth client ID מסוג Desktop app) "
            f"ושמור אותו כאן: {config.GOOGLE_CREDENTIALS_PATH}"
        )
    flow = InstalledAppFlow.from_client_secrets_file(
        str(config.GOOGLE_CREDENTIALS_PATH), config.GOOGLE_SCOPES
    )
    creds = flow.run_local_server(port=0)
    config.GOOGLE_TOKEN_PATH.write_text(creds.to_json())
    print(f"החיבור הצליח! נשמר: {config.GOOGLE_TOKEN_PATH}")


if __name__ == "__main__":
    main()
