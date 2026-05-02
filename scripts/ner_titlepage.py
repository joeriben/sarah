#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
# SPDX-License-Identifier: AGPL-3.0-or-later
"""
NER-Service für die Anonymisierungs-Pipeline.

Liest JSON von stdin: { "text": "...", "lang": "de" | "en" | "auto" }
Liefert JSON an stdout: { "entities": [{"text": "...", "label": "PER"|"ORG"|"LOC"|"MISC", "start": int, "end": int}, ...] }

Modell: spaCy de_core_news_lg / en_core_web_sm (lokal, kein externes LLM).

Aufruf aus Node:
    spawn('python3', ['scripts/ner_titlepage.py'])

Stdin-JSON wird gelesen bis EOF, dann verarbeitet, dann Stdout-JSON ausgegeben
und Prozess beendet. Für Daemon-Modus s.u. (TODO).
"""
from __future__ import annotations
import sys
import json
import os

# Lazy load — Modell-Load (~545MB) braucht ~3s. Wir laden bewusst pro
# Aufruf, weil die Anzahl Aufrufe pro Dokument 1 ist und ein Daemon-Modus
# Komplexität (Lifecycle, Concurrency) bringt, die wir aktuell nicht brauchen.
_MODEL_CACHE = {}


def get_nlp(lang: str):
    if lang in _MODEL_CACHE:
        return _MODEL_CACHE[lang]
    import spacy

    if lang == "de":
        nlp = spacy.load("de_core_news_lg", disable=["lemmatizer"])
    elif lang == "en":
        nlp = spacy.load("en_core_web_sm", disable=["lemmatizer"])
    else:
        # auto: probiere de zuerst (FAU-Kontext), Fallback en
        try:
            nlp = spacy.load("de_core_news_lg", disable=["lemmatizer"])
        except OSError:
            nlp = spacy.load("en_core_web_sm", disable=["lemmatizer"])
    _MODEL_CACHE[lang] = nlp
    return nlp


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        json.dump({"entities": []}, sys.stdout)
        return
    payload = json.loads(raw)
    text = payload.get("text", "")
    lang = payload.get("lang", "auto")

    if not text:
        json.dump({"entities": []}, sys.stdout)
        return

    nlp = get_nlp(lang)
    doc = nlp(text)
    entities = [
        {
            "text": ent.text,
            "label": ent.label_,
            "start": ent.start_char,
            "end": ent.end_char,
        }
        for ent in doc.ents
    ]
    json.dump({"entities": entities}, sys.stdout)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        json.dump({"error": f"{type(e).__name__}: {e}", "entities": []}, sys.stdout)
        sys.exit(1)
