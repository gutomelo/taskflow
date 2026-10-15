# Lista de senhas comuns (BR-011)

- **Arquivo**: `common-passwords.txt` — uma senha por linha, normalizada (Unicode NFC, minúsculas), sem duplicatas, linhas vazias ou caracteres de controle. Ordem original (mais frequentes primeiro).
- **Origem**: SecLists, `Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt` (<https://github.com/danielmiessler/SecLists>), lista das 100 mil senhas mais frequentes publicada pelo NCSC (Reino Unido) a partir de dados do Have I Been Pwned.
- **SHA-256 do arquivo de origem**: `c2e5696882c603b76bb67a47ee970897e5a76fc4c3f5547abe3d0ca340c576e0` (baixado em 2026-10-08).
- **Licença**: MIT — Copyright (c) 2018 Daniel Miessler (licença do repositório SecLists).
- **Uso**: verificação case-insensitive em `FileCommonPasswordList`; nenhum dado pessoal (apenas senhas, sem associação a contas).
- **Atualização**: substitua o arquivo de origem, gere novamente com a mesma normalização e atualize o hash acima.
