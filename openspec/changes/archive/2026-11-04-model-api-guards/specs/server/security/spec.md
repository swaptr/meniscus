## ADDED Requirements

### Requirement: No contributor models
Loading configuration SHALL fail, naming the variable, when `SPARK_MODEL`, `SAM_MODEL` or `ASR_MODEL` is a contributor-mode model id (one ending in `-contributor`, in any letter case), because contributor mode lets Meta train on patient content and is refused under zero data retention. The server does not start, and it sends 0 upstream requests.

#### Scenario: Contributor Spark
- **WHEN** config is loaded with `SPARK_MODEL=muse-spark-1.3-contributor`
- **THEN** loading throws an error naming `SPARK_MODEL`, and the upstream received no request

#### Scenario: Any letter case, any model variable
- **WHEN** config is loaded with `SPARK_MODEL=MUSE-SPARK-1.2-CONTRIBUTOR`, and separately with `SAM_MODEL=sam-3.1-contributor`
- **THEN** both loads throw, naming `SPARK_MODEL` and `SAM_MODEL`

#### Scenario: Standard models
- **WHEN** config is loaded with no model variables, and separately with `SPARK_MODEL=muse-spark-1.2`
- **THEN** both loads succeed, with Spark `muse-spark-1.3` and `muse-spark-1.2`
