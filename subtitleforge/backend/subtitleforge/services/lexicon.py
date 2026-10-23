"""Word lists the enhancer relies on.

Kept separate from the logic so a user-supplied glossary can extend it without
touching code: a channel that says "Kubernetes" and "gRPC" every episode adds
them once in Settings and every later transcript capitalises them correctly.
"""

from __future__ import annotations

# Fillers safe to delete outright. Each is meaningless on its own in English
# speech; anything ambiguous ("like", "right") is handled by context rules.
HARD_FILLERS = {
    "um", "umm", "ummm", "uh", "uhh", "uhhh", "er", "err", "erm", "ah", "ahh",
    "eh", "hmm", "hm", "mmm", "mhm", "uh-huh", "mm-hmm", "ehm", "uhm",
}

# Phrases that pad speech. Removed only when they are not the whole sentence.
SOFT_FILLER_PHRASES = (
    "you know",
    "i mean",
    "sort of",
    "kind of",
    "you see",
    "if you will",
    "or something like that",
    "at the end of the day",
)

# Single words that pad a sentence when they open or close a clause.
HEDGE_WORDS = {"basically", "actually", "literally", "honestly", "obviously", "essentially", "just", "really"}

# Words that reliably start a new sentence in spoken English.
SENTENCE_STARTERS = {
    "so", "but", "and then", "now", "today", "tomorrow", "yesterday", "okay", "ok", "alright",
    "anyway", "anyhow", "however", "meanwhile", "first", "firstly", "second", "secondly", "third",
    "next", "then", "finally", "lastly", "also", "plus", "because of that", "after that",
    "before that", "in this video", "in today's video", "in the next video", "let's", "lets",
    "welcome", "hello", "hi", "hey", "thanks", "thank you", "remember", "look", "listen",
    "the point is", "the thing is", "that said", "on the other hand", "for example", "for instance",
    "by the way", "to be clear", "in short", "in other words", "of course", "again", "once more",
}

# Greetings and vocatives: "hello guys" takes a comma, not a full stop.
GREETINGS = {"hello", "hi", "hey", "welcome", "greetings", "good morning", "good afternoon", "good evening", "yo"}
VOCATIVES = {
    "guys", "everyone", "everybody", "folks", "all", "there", "friends", "team", "y'all", "yall",
    "my friends", "guys and girls", "people",
}

QUESTION_OPENERS = {
    "what", "why", "how", "when", "where", "who", "whom", "whose", "which",
    "do", "does", "did", "can", "could", "would", "will", "shall", "should",
    "is", "are", "was", "were", "am", "have", "has", "had", "may", "might",
}

# Acronyms and trade names, in the casing their owners use.
ACRONYMS = {
    "ai": "AI", "agi": "AGI", "api": "API", "apis": "APIs", "ui": "UI", "ux": "UX", "cli": "CLI",
    "gui": "GUI", "url": "URL", "urls": "URLs", "http": "HTTP", "https": "HTTPS", "html": "HTML",
    "css": "CSS", "sql": "SQL", "json": "JSON", "csv": "CSV", "pdf": "PDF", "usb": "USB",
    "cpu": "CPU", "gpu": "GPU", "ram": "RAM", "ssd": "SSD", "hdd": "HDD", "os": "OS",
    "ios": "iOS", "pc": "PC", "mac": "Mac", "ceo": "CEO", "cto": "CTO", "cfo": "CFO", "coo": "COO",
    "hr": "HR", "kpi": "KPI", "kpis": "KPIs", "roi": "ROI", "saas": "SaaS", "b2b": "B2B", "b2c": "B2C",
    "seo": "SEO", "crm": "CRM", "erp": "ERP", "mvp": "MVP", "poc": "PoC", "qa": "QA", "ci": "CI",
    "cd": "CD", "aws": "AWS", "gcp": "GCP", "sdk": "SDK", "ide": "IDE", "npm": "npm", "ssh": "SSH",
    "dns": "DNS", "vpn": "VPN", "ip": "IP", "tv": "TV", "hd": "HD", "4k": "4K", "8k": "8K",
    "fps": "FPS", "srt": "SRT", "vtt": "VTT", "ass": "ASS", "mp4": "MP4", "mp3": "MP3", "wav": "WAV",
    "llm": "LLM", "llms": "LLMs", "ml": "ML", "nlp": "NLP", "ocr": "OCR", "asr": "ASR", "tts": "TTS",
    "gdpr": "GDPR", "nda": "NDA", "faq": "FAQ", "diy": "DIY", "asap": "ASAP",
    "usa": "USA", "uk": "UK", "eu": "EU", "un": "UN", "nasa": "NASA", "fbi": "FBI", "cia": "CIA",
}

PROPER_NOUNS = {
    # Titles, so "dr. smith" reads as "Dr. smith" rather than starting a new
    # sentence at the abbreviation's period.
    "dr": "Dr", "dr.": "Dr.", "mr": "Mr", "mr.": "Mr.", "mrs": "Mrs", "mrs.": "Mrs.",
    "ms": "Ms", "ms.": "Ms.", "prof": "Prof", "prof.": "Prof.",
    "monday": "Monday", "tuesday": "Tuesday", "wednesday": "Wednesday", "thursday": "Thursday",
    "friday": "Friday", "saturday": "Saturday", "sunday": "Sunday",
    "january": "January", "february": "February", "march": "March", "april": "April",
    "june": "June", "july": "July", "august": "August", "september": "September",
    "october": "October", "november": "November", "december": "December",
    "english": "English", "french": "French", "german": "German", "spanish": "Spanish",
    "chinese": "Chinese",
    "japanese": "Japanese", "khmer": "Khmer", "america": "America", "american": "American",
    "europe": "Europe", "african": "African", "asia": "Asia", "india": "India", "china": "China",
    "google": "Google", "youtube": "YouTube", "facebook": "Facebook", "instagram": "Instagram",
    "tiktok": "TikTok", "twitter": "Twitter", "linkedin": "LinkedIn", "whatsapp": "WhatsApp",
    "microsoft": "Microsoft", "windows": "Windows", "apple": "Apple", "iphone": "iPhone",
    "ipad": "iPad", "android": "Android", "netflix": "Netflix", "amazon": "Amazon",
    "spotify": "Spotify", "photoshop": "Photoshop", "premiere": "Premiere", "capcut": "CapCut",
    "davinci": "DaVinci", "python": "Python", "javascript": "JavaScript", "typescript": "TypeScript",
    "react": "React", "node": "Node", "github": "GitHub", "docker": "Docker", "linux": "Linux",
    "ubuntu": "Ubuntu", "chrome": "Chrome", "firefox": "Firefox", "safari": "Safari",
    "excel": "Excel", "powerpoint": "PowerPoint", "chatgpt": "ChatGPT", "openai": "OpenAI",
    "claude": "Claude", "anthropic": "Anthropic", "whisper": "Whisper", "ffmpeg": "FFmpeg",
}

# High-precision repairs. Each is wrong in every context, so applying them
# blind cannot introduce an error.
GRAMMAR_FIXES = {
    "dont": "don't", "doesnt": "doesn't", "didnt": "didn't", "cant": "can't", "wont": "won't",
    "wouldnt": "wouldn't", "shouldnt": "shouldn't", "couldnt": "couldn't", "isnt": "isn't",
    "arent": "aren't", "wasnt": "wasn't", "werent": "weren't", "hasnt": "hasn't",
    "havent": "haven't", "hadnt": "hadn't", "im": "I'm", "ive": "I've", "ill": "I'll",
    "id": "I'd", "youre": "you're", "youve": "you've", "youll": "you'll",
    "theyre": "they're", "theyve": "they've", "thats": "that's", "whats": "what's",
    "lets": "let's", "its'": "its", "alot": "a lot", "aswell": "as well",
    "incase": "in case", "infront": "in front", "everytime": "every time",
    "atleast": "at least", "untill": "until", "recieve": "receive", "seperate": "separate",
    "definately": "definitely", "occured": "occurred", "becuase": "because", "teh": "the",
    "wanna": "want to", "gonna": "going to", "gotta": "got to", "kinda": "kind of",
    "sorta": "sort of", "lemme": "let me", "gimme": "give me", "cuz": "because", "coz": "because",
}

# Only applied when "formalize" is on: spoken shorthand a caption can keep.
CASUAL_KEEP = {"wanna", "gonna", "gotta", "kinda", "sorta", "lemme", "gimme", "cuz", "coz"}
