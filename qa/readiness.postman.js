pm.test('Ready endpoint succeeds', () => pm.response.to.have.status(200));
pm.test('The intended read-only app answered', () => {
  const result = pm.response.json();
  pm.expect(result.app).to.equal('canopy');
  pm.expect(result.status).to.equal('ok');
  pm.expect(result.read_only).to.equal(true);
});
pm.test('Private responses are not cached', () => pm.expect(pm.response.headers.get('Cache-Control')).to.equal('no-store'));
