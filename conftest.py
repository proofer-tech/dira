"""도그푸딩 워커 세션의 앰비언트 env가 test_ontology.py의 dryrun() 기준선으로 새는 것을 막는다.

pytest가 세션 시작 시 자동으로 읽어 들이는 훅이라 test_ontology.py 자체는 안 건드린다.
결정 근거: 티켓 08c316f9 ## 블록 문항 1의 (d).
"""
import os

for _k in ("TICKET_ONTOLOGY", "TICKET_DONE", "TICKET_INPROGRESS"):
    os.environ.pop(_k, None)
