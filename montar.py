"""Monta public/index.html a partir do mdquest.html original + adaptador.
Uso: python3 montar.py caminho/para/mdquest.html"""
import sys, shutil, pathlib
aqui = pathlib.Path(__file__).parent
orig = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
cabeca = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="/config.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="/mdquest-adaptador.js"></script>
"""
orig = orig.replace("<title>Artefato Mariana</title>", "<title>MDQuest</title>", 1)
(aqui / "public" / "index.html").write_text(cabeca + orig + "\n</html>\n", encoding="utf-8")
shutil.copy(aqui / "mdquest-adaptador.js", aqui / "public" / "mdquest-adaptador.js")
print("ok:", (aqui / "public" / "index.html").stat().st_size, "bytes")
