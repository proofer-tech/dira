#!/usr/bin/env python3
"""claim 락 동시성 자체검증: 같은 티켓에 24개 프로세스가 동시에 달려들어도 승자는 정확히 1명인가.

하드링크 경로(os.link)와 미지원 폴백 경로(O_CREAT|O_EXCL) 둘 다 태운다. 폴백이 os.rename이던
시절엔 exists() 선검사가 TOCTOU라 둘 다 통과 -> dst를 덮어써서 두 세션이 같은 티켓을 들었다.
구글드라이브 같은 FUSE 마운트에 티켓 루트를 두면 그 폴백 경로만 타므로, 여기서 안 재면 아무도 안 잰다.
"""
import os
import sys
import errno
import shutil
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tickets as T   # noqa: E402

N = 24
BODY = "---\nticket: a1b2c3d4\ntitle: race\n---\n\n## Goal\n원본-내용-마커\n"


def race(nolink):
    """N개 자식이 동시에 claim. (승자 수, 예외로 죽은 수)를 돌려준다."""
    tmp = tempfile.mkdtemp()
    try:
        src = os.path.join(tmp, "a1b2c3d4.md")
        with open(src, "w", encoding="utf-8") as f:
            f.write(BODY)

        # 출발 배리어: 자식은 파이프에서 1바이트를 기다리고, 부모가 한 번에 N바이트를 푼다.
        r, w = os.pipe()
        pids = []
        for _ in range(N):
            pid = os.fork()
            if pid == 0:
                os.close(w)
                os.read(r, 1)
                if nolink:      # fork 뒤 자식에서만 하드링크를 막는다(운영 코드에 테스트 훅 없이)
                    def boom(*a, **k):
                        raise OSError(errno.EPERM, "hardlink unsupported")
                    T.os.link = boom
                try:
                    T.claim(src)
                    os._exit(0)                 # 승자
                except SystemExit:
                    os._exit(1)                 # "이미 잡힘" = 정상 패배
                except Exception:
                    os._exit(2)                 # 그 외 = 락 깨짐
            pids.append(pid)
        os.close(r)
        os.write(w, b"x" * N)
        os.close(w)

        codes = [os.waitpid(p, 0)[1] >> 8 for p in pids]
        left = sorted(os.listdir(tmp))
        assert left == ["a1b2c3d4" + T.IN_PROGRESS + ".md"], "잡은 뒤 파일 상태가 이상하다: {}".format(left)
        with open(os.path.join(tmp, left[0]), encoding="utf-8") as f:
            assert f.read() == BODY, "티켓 내용이 훼손됐다"
        return codes.count(0), codes.count(2)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


for nolink in (False, True):
    path = "O_EXCL 폴백" if nolink else "os.link"
    won, broke = race(nolink)
    assert broke == 0, "{}: 예상 못한 예외 {}건".format(path, broke)
    assert won == 1, "{}: 승자가 {}명이다(락 깨짐)".format(path, won)
    print("PASS {} 경로 - {}개 동시 claim 중 승자 1명".format(path, N))
