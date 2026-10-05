import hashlib
from pathlib import Path


def source_revision(root: Path) -> str:
    sources = sorted([*root.glob('backend/app/*.py'),
                      *root.glob('frontend/src/**/*.ts'), *root.glob('frontend/src/**/*.tsx'),
                      *root.glob('frontend/src/**/*.css')])
    digest = hashlib.sha256()
    for path in sources:
        digest.update(path.relative_to(root).as_posix().encode('utf-8'))
        digest.update(b'\0')
        digest.update(path.read_bytes())
        digest.update(b'\0')
    return digest.hexdigest()
