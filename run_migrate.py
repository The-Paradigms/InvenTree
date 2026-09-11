import os
import sys
import traceback

os.environ['DJANGO_SETTINGS_MODULE'] = 'InvenTree.settings'
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src', 'backend', 'InvenTree'))

try:
    print("Starting...", flush=True)
    import django
    print("Importing django.setup...", flush=True)
    django.setup()
    print("Django setup OK", flush=True)
    
    print("Running migrate...", flush=True)
    from django.core.management import call_command
    call_command('migrate', run_syncdb=True)
    print("Migration complete!", flush=True)
except Exception as e:
    print(f"ERROR: {e}", flush=True)
    traceback.print_exc()
finally:
    print("Script finished", flush=True)
