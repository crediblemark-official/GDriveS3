export function xmlListBuckets(buckets: { name: string; createdAt: string }[]): string {
  const bucketList = buckets
    .map(
      (b) => `    <Bucket>
      <Name>${escapeXml(b.name)}</Name>
      <CreationDate>${escapeXml(b.createdAt)}</CreationDate>
    </Bucket>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Owner>
    <ID>g3</ID>
    <DisplayName>g3</DisplayName>
  </Owner>
  <Buckets>
${bucketList}
  </Buckets>
</ListAllMyBucketsResult>`;
}

export function xmlListObjectsV2(
  bucketName: string,
  prefix: string,
  contents: { key: string; size: number; etag: string; updatedAt: string }[],
  commonPrefixes: string[] = []
): string {
  const contentsXml = contents
    .map(
      (c) => `  <Contents>
    <Key>${escapeXml(c.key)}</Key>
    <LastModified>${escapeXml(c.updatedAt)}</LastModified>
    <ETag>"${escapeXml(c.etag)}"</ETag>
    <Size>${c.size}</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>`
    )
    .join("\n");

  const prefixesXml = commonPrefixes
    .map(
      (p) => `  <CommonPrefixes>
    <Prefix>${escapeXml(p)}</Prefix>
  </CommonPrefixes>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${escapeXml(bucketName)}</Name>
  <Prefix>${escapeXml(prefix)}</Prefix>
  <KeyCount>${contents.length + commonPrefixes.length}</KeyCount>
  <MaxKeys>1000</MaxKeys>
  <IsTruncated>false</IsTruncated>
${contentsXml}
${prefixesXml}
</ListBucketResult>`;
}

export function xmlInitiateMultipart(bucket: string, key: string, uploadId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>${escapeXml(bucket)}</Bucket>
  <Key>${escapeXml(key)}</Key>
  <UploadId>${escapeXml(uploadId)}</UploadId>
</InitiateMultipartUploadResult>`;
}

export function xmlCompleteMultipart(bucket: string, key: string, etag: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Location>/${escapeXml(bucket)}/${escapeXml(key)}</Location>
  <Bucket>${escapeXml(bucket)}</Bucket>
  <Key>${escapeXml(key)}</Key>
  <ETag>"${escapeXml(etag)}"</ETag>
</CompleteMultipartUploadResult>`;
}

export function xmlError(code: string, message: string, resource: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>${escapeXml(code)}</Code>
  <Message>${escapeXml(message)}</Message>
  <Resource>${escapeXml(resource)}</Resource>
  <RequestId>${crypto.randomUUID()}</RequestId>
</Error>`;
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return c;
    }
  });
}
