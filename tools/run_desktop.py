"""PyInstaller-safe launcher for DelibraShift Lab."""

from delibrashift.desktop import main


if __name__ == "__main__":
    raise SystemExit(main())
