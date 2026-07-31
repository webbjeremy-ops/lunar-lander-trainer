#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
#
# M3.3D Gate 3/4 — assemble the double-pass leaf transcriptions into the
# canonical, typed deck file.
#
#   python3 scripts/assemble-apollo11-deck-1969.py
#
# Inputs  : src/simulation/apollo11Deck/transcription/leaf{11..25}.json
#           src/simulation/apollo11Deck/luminary099.erasableSymbols.json
#           src/simulation/apollo11Deck/deck1969.pageManifest.json
# Output  : src/simulation/apollo11Deck/deck1969.transcribed.json
#
# The script NEVER invents, corrects or interpolates a printed value. It only
# reshapes agreed two-pass readings and attaches the pinned rope address for
# cross-checking. Disagreements and unreadable fields are propagated as-is so
# the TypeScript validator can refuse the deck.

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "src", "simulation", "apollo11Deck")
TRANS = os.path.join(BASE, "transcription")

AGC_LEAVES = list(range(13, 22))
EXTERNAL_LEAVES = [23, 24, 25]
RUNCONTROL_LEAVES = [11, 12]
ASTRONAUT_LEAF = 22

SYMBOLS = json.load(open(os.path.join(BASE, "luminary099.erasableSymbols.json")))["symbols"]
PAGES = json.load(open(os.path.join(BASE, "deck1969.pageManifest.json")))

SYMBOL_RE = re.compile(r"^(-?[A-Z0-9][A-Z0-9/*\-.]*?)(?:\+(\d+)(D?))?$")


def load(leaf):
    return json.load(open(os.path.join(TRANS, f"leaf{leaf}.json")))


def resolve_pinned(symbol, offset_field):
    """Address of `symbol` in pinned Luminary099, or -1 when unknown."""
    if not symbol:
        return -1
    m = SYMBOL_RE.match(symbol.strip())
    if not m:
        return -1
    base = SYMBOLS.get(m.group(1))
    if base is None:
        return -1
    extra = int(m.group(2)) if m.group(2) else 0
    if offset_field:
        mo = re.match(r"^\+(\d+)D?$", offset_field.strip())
        if mo:
            extra += int(mo.group(1))
    return base + extra


def field(raw, leaf, printed_page, column, status=None):
    p1 = (raw or {}).get("pass1", "")
    p2 = (raw or {}).get("pass2", "")
    agreed = p1 == p2
    final = (raw or {}).get("final")
    st = status or ("verified" if agreed and final not in (None, "") else "conflict")
    if final in (None, ""):
        st = status or "unreadable"
    return {
        "pass1": p1,
        "pass2": p2,
        "agreed": agreed,
        "scanLeaf": leaf,
        "printedPage": printed_page,
        "boundingBoxOrColumn": column,
        "ocrLocatorText": None,
        "finalValue": final,
        "status": st,
    }


def printed_page_of(leaf):
    for p in PAGES.get("pages", []):
        if p.get("scanLeaf") == leaf:
            return p.get("printedPage")
    return None


def words_of(rec):
    if "wordsOctal" in rec:
        return rec["wordsOctal"]
    w = rec.get("wordOctal") or {}
    return {
        "pass1": [w.get("pass1", "")],
        "pass2": [w.get("pass2", "")],
        "agreed": w.get("agreed", False),
        "final": [w["final"]] if w.get("final") else None,
    }


def build_agc_records():
    out = []
    ordinal = 0
    for leaf in AGC_LEAVES:
        page = printed_page_of(leaf)
        d = load(leaf)
        for rec in d["records"]:
            ordinal += 1
            sym = (rec.get("symbol") or {}).get("final") or ""
            addr_raw = rec.get("addressOctal") or {}
            addr_final = addr_raw.get("final")
            wraw = words_of(rec)
            wfinal = wraw.get("final") or []
            status = rec.get("status")
            fields = [
                field(rec.get("symbol"), leaf, page, "symbol",
                      "verified" if sym else "unreadable"),
                field(addr_raw, leaf, page, "address-octal"),
                field(
                    {
                        "pass1": " ".join(wraw.get("pass1") or []),
                        "pass2": " ".join(wraw.get("pass2") or []),
                        "final": " ".join(wfinal) if wfinal else None,
                    },
                    leaf, page, "octal-words",
                ),
            ]
            if status == "unreadable":
                fields = [dict(f, status="unreadable") for f in fields]
            out.append({
                "ordinal": ordinal,
                "symbol": (sym + (rec.get("offset") or "")) if sym else "",
                "format": rec.get("format") or "other",
                "addressOctal": addr_final or "",
                "address": int(addr_final, 8) if addr_final else -1,
                "rawWordsOctal": wfinal,
                "rawWords": [int(w, 8) for w in wfinal] if wfinal else [],
                "printedDecodedValue": (rec.get("printedDecoded") or {}).get("final"),
                "pinnedSymbolAddress": resolve_pinned(sym, rec.get("offset")),
                "recordClass": "unclassified",
                "scan": {
                    "scanLeaf": leaf,
                    "printedPage": page,
                    "boundingBoxOrColumn": rec.get("tile") or "",
                },
                "fields": fields,
            })
    return out


def build_external_records():
    out = []
    ordinal = 0
    for leaf in RUNCONTROL_LEAVES:
        page = printed_page_of(leaf)
        d = load(leaf)
        for line in d["lines"]:
            ordinal += 1
            out.append({
                "ordinal": ordinal,
                "subsystem": "special-request",
                "cardId": f"leaf{leaf}-line{line['ordinal']}",
                "fields": [field(line.get("rawLine"), leaf, page, "card-line",
                                 line.get("status"))],
                "semantics": None,
                "implementationStatus": "validation-only",
            })
    subsystem_by_leaf = {23: "prelaunch", 24: "imu", 25: "lem"}
    for leaf in EXTERNAL_LEAVES:
        page = printed_page_of(leaf)
        d = load(leaf)
        for blk in d["blocks"]:
            ordinal += 1
            fields = [field(blk.get("headerLine"), leaf, page, "block-header")]
            for i, vl in enumerate(blk.get("valueLines", [])):
                fields.append(field(vl, leaf, page, f"value-line-{i + 1}"))
            out.append({
                "ordinal": ordinal,
                "subsystem": subsystem_by_leaf[leaf],
                "cardId": f"leaf{leaf}-block{blk['ordinal']}",
                "fields": fields,
                "semantics": None,
                "implementationStatus": "unresolved",
            })
    return out


DSKY_TOKEN = re.compile(r"\b(V|N)\s*(\d{2})\b|\b(E)\b|\b(PROCEED|ENTER|KR)\b")


def parse_astronaut_card(text):
    """Classify a printed astronaut card without altering its text."""
    body = re.sub(r"^A\s+", "", text.strip())
    wait = re.match(r"^WAIT\s+(\d+)\s+(.*)$", body)
    cond_v_n = re.match(r"^IF\s+V\s*(\d{2})\s+N\s*(\d{2})\b", body)
    verify = re.match(r"^VERIFY\s+WITHIN\s+(\d+)\b", body)
    if cond_v_n:
        trigger = {
            "kind": "display-condition",
            "verb": int(cond_v_n.group(1)),
            "noun": int(cond_v_n.group(2)),
        }
    elif wait:
        trigger = {"kind": "wait-seconds", "seconds": int(wait.group(1))}
    elif verify:
        trigger = {"kind": "wait-seconds", "seconds": int(verify.group(1))}
    else:
        trigger = {"kind": "immediate"}

    keys = []
    for tok in re.findall(r"V\s*\d{2}|N\s*\d{2}|\bE\b|\bPROCEED\b|\bENTER\b|[+-]?\d{5}", body):
        keys.append(re.sub(r"\s+", "", tok))
    is_dsky = bool(re.search(r"\bV\s*\d{2}\b", body))
    if is_dsky:
        action = {"kind": "dsky", "printed": body, "keys": keys}
    else:
        action = {
            "kind": "switch",
            "printed": body,
            "signal": body.split()[0] if body.split() else "",
            "value": " ".join(body.split()[1:]),
        }
    return trigger, action


def build_astronaut_program():
    leaf = ASTRONAUT_LEAF
    page = printed_page_of(leaf)
    d = load(leaf)
    out = []
    for card in d["cards"]:
        text = (card.get("rawLine") or {}).get("final") or ""
        trigger, action = parse_astronaut_card(text)
        out.append({
            "ordinal": card["ordinal"],
            "trigger": trigger,
            "action": action,
            "scan": {
                "scanLeaf": leaf,
                "printedPage": page,
                "boundingBoxOrColumn": card.get("tile") or "",
            },
            "rawLine": field(card.get("rawLine"), leaf, page, "card-line",
                             card.get("status")),
        })
    return out


def main():
    agc = build_agc_records()
    ext = build_external_records()
    ast = build_astronaut_program()

    unresolved = 0
    for r in agc:
        unresolved += sum(1 for f in r["fields"] if f["status"] != "verified")
    for r in ext:
        unresolved += sum(1 for f in r["fields"] if f["status"] != "verified")
    for a in ast:
        unresolved += 0 if a["rawLine"]["status"] == "verified" else 1

    deck = {
        "deckId": "apollo11-1969-mit-input-deck-v1",
        "itemId": "apollo11landingd00miti_0",
        "software": "LMY99",
        "run": "LRRADAR2.ENVCNTRL 07/23/69 14:43 /EYLES /DUPLICATE LANDING",
        "marsrotTape": "MARSROT 20414415",
        "pages": PAGES.get("pages", []),
        "agcRecords": agc,
        "externalRecords": ext,
        "astronautProgram": ast,
        "admissibility": {
            "verdict": "input-deck-transcription-incomplete",
            "unresolvedFieldCount": unresolved,
            "notes": (
                "Assembled by scripts/assemble-apollo11-deck-1969.py from two "
                "independent visual passes per leaf. Verdict is set by "
                "deck1969Validator.ts, not by this script."
            ),
        },
    }
    path = os.path.join(BASE, "deck1969.transcribed.json")
    with open(path, "w") as fh:
        json.dump(deck, fh, indent=1)
        fh.write("\n")
    print(f"agcRecords={len(agc)} externalRecords={len(ext)} "
          f"astronautCards={len(ast)} unresolvedFields={unresolved}")
    print(f"wrote {os.path.relpath(path, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
