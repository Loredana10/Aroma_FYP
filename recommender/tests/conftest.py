# 
# recommender/conftest.py
# ============
# Tells pytest where to find recommender.py when tests are run from
# the recommender/ folder or from inside recommender/tests/.

# Usage:
#     cd recommender/
#     pytest tests/ -v --cov=recommender --cov-report=term-missing
# 

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))