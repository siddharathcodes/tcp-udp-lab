import json,re
d='/home/claude/netreliability/'
head=open(d+'build/head.html').read(); body=open(d+'build/body.html').read()
js=open(d+'build/engine.js').read()+'\n'+open(d+'build/ui.js').read()
sample=json.dumps(json.load(open(d+'build/sample.json')),separators=(',',':'))
js=js.replace('__SAMPLE__',sample)
page=head+body+'<script>\n'+js+'\n</script>\n'
open(d+'build/artifact.html','w').write(page)
wrapped='<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'+head+'</head>\n<body>\n'+body+'<script>\n'+js+'\n</script>\n</body>\n</html>\n'
open(d+'static/index.html','w').write(wrapped)
print(len(page))
