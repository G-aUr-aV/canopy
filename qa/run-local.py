"""Run real auth plus fixture UI checks against one disposable loopback preview."""
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from backend.auth import bootstrap
with tempfile.TemporaryDirectory(prefix='canopy-auth-qa-') as directory:
    bootstrap(Path(directory))
    env={**os.environ,'CANOPY_AUTH_FILE':directory+'/auth.json','CANOPY_QA_AUTH_DIR':directory,'CANOPY_ORIGIN':'http://127.0.0.1:4320'}
    server=subprocess.Popen(['.venv/bin/python','-m','uvicorn','backend.app:app','--host','127.0.0.1','--port','4320','--no-access-log','--log-level','warning'],env=env)
    try:
        for _ in range(100):
            if server.poll() is not None: raise RuntimeError('Preview did not start')
            try:
                with urllib.request.urlopen(env['CANOPY_ORIGIN']+'/readyz',timeout=1) as response: break
            except OSError: time.sleep(.1)
        else: raise RuntimeError('Preview did not become ready')
        for script in (sys.argv[1:] or ['auth.mjs','browser.mjs','session-install.mjs','contrast.mjs']):
            subprocess.run(['node','qa/'+script],env=env,check=True,timeout=180)
    finally:
        server.terminate()
        try: server.wait(timeout=5)
        except subprocess.TimeoutExpired: server.kill();server.wait()
