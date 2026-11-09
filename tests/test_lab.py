from lab.impair import Impairment
from lab.rdt import run_rdt
from lab.tcp_test import run_tcp
from lab.udp_test import run_udp


def test_udp_clean_network_delivers_everything():
    r = run_udp(n=60, imp=Impairment())
    assert r["delivery_pct"] == 100 and r["duplicates"] == 0


def test_udp_loses_data_under_loss():
    r = run_udp(n=150, imp=Impairment(loss=0.25), seed=3)
    assert r["delivery_pct"] < 100 and r["lost"] > 0


def test_udp_shows_duplicates():
    r = run_udp(n=100, imp=Impairment(dup=0.3), seed=2)
    assert r["duplicates"] > 0


def test_tcp_real_is_ordered_and_complete():
    r = run_tcp(n=60, imp=Impairment(delay_ms=2))
    assert r["delivery_pct"] == 100 and r["in_order"]


def test_tcp_like_recovers_from_loss_in_order():
    r = run_rdt(n=120, imp=Impairment(loss=0.2), seed=5)
    assert r["delivery_pct"] == 100 and r["in_order"]
    assert r["retransmissions"] > 0


def test_tcp_like_handles_dup_and_reorder():
    r = run_rdt(n=100, imp=Impairment(dup=0.2, reorder=0.2, delay_ms=3), seed=7)
    assert r["delivery_pct"] == 100 and r["in_order"]
