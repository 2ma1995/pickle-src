"""Check local screens at desktop/mobile widths with isolated sample state.
Run: python3 scripts/ux-check.py (requires the installed Playwright package).
Screenshots go to /tmp/pickle-ux; no project/user data is changed.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path('/tmp/pickle-ux')
OUT.mkdir(exist_ok=True)
failures = []
count = 0
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for width in (320, 390, 768, 1440):
        context = browser.new_context(viewport={'width': width, 'height': 900})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        for app in ('index',):  # 프로토가 앱(index.html)이 됐다. proto.html 은 index.html 로 넘기는 이동 페이지라 따로 안 본다
            page.goto((ROOT / f'app/{app}.html').as_uri(), wait_until='load')
            seed = page.evaluate('''() => {
                const p = D.perfs.find(p => p.date >= '2026-10-11' && !(p.notes || []).some(n => /대관/.test(n)));
                if (!p) throw new Error('No future performance fixture');
                S.prefs = {axes:['맑은 음색'],works:[],favs:[],grade:''};
                S.plans = [{...p, quick:'good'}]; S.tags=[]; S.votes=[];
                save();
                return {work:p.work,date:p.date,time:p.time,
                    other:D.works.find(w => !w.hasSchedule)?.name,
                    current:liveShows(D,'2026-10-11')[0]?.id};
            }''')
            work, date, time = seed['work'], seed['date'], seed['time']
            routes = ([f'taste/{n}' for n in (1,2,3,4)] + ['home', f'show/{work}', f'day/{work}/{date}', 'privacy', f'duel/{work}']
                      + ['works', f'pick/{work}', f'when/{work}', f'result/{work}', 'onboard/1'])  # 뒤 다섯은 예전 주소(새 화면으로 연결)
            routes += [f'cal/{work}', f'detail/{work}/{date}/{time}', 'saved/0', 'plans', 'tag/0', 'me']
            if seed.get('other'):
                routes += [f"show/{seed['other']}"]
            if seed.get('current'):
                routes += [f"cshow/{seed['current']}"]
            for i, route in enumerate(routes):
                errors.clear()
                page.evaluate('(route) => { location.hash = route; }', route)
                page.wait_for_timeout(90)
                assert page.locator('#view').inner_text().strip(), f'Empty screen: {app}/{route}'
                overflow = page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
                if overflow or errors:
                    failures.append(f'{width} {app}/{route}: overflow={overflow}, errors={errors[:]}')
                page.screenshot(path=str(OUT / f'{app}-{width}-{i:02d}.png'))
                count += 1
            # Selected state uses the real click handler.
            page.evaluate("location.hash = '#taste/1'")
            page.wait_for_timeout(90)
            button = page.locator('.obcard').first
            button.click()
            assert page.locator('.obcard').first.get_attribute('aria-pressed') == 'true'
            page.screenshot(path=str(OUT / f'{app}-{width}-selected.png'))
            page.evaluate("S.plans=[]; S.prefs=null; save()")
            for route in ('plans', 'me'):
                page.evaluate('(route) => { location.hash = route; }', route)
                page.wait_for_timeout(90)
                assert page.locator('#view').inner_text().strip()
                assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
                page.screenshot(path=str(OUT / f'{app}-{width}-{route}-empty.png'))
                count += 1
        page.goto((ROOT / 'index.html').as_uri(), wait_until='load')
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 1'), 'Landing overflow'
        page.screenshot(path=str(OUT / f'landing-{width}.png'), full_page=True)
        count += 1
        context.close()
    browser.close()
assert not failures, '\n'.join(failures)
print(f'UX checks passed: {count} screens, 8 selection interactions; screenshots: {OUT}')
