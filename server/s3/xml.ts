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

export interface ListObjectsV2XmlOptions {
  maxKeys?: number;
  isTruncated?: boolean;
  continuationToken?: string;
  nextContinuationToken?: string;
}

export function xmlListObjectsV2(
  bucketName: string,
  prefix: string,
  contents: { key: string; size: number; etag: string; updatedAt: string }[],
  commonPrefixes: string[] = [],
  options?: ListObjectsV2XmlOptions
): string {
  const maxKeys = options?.maxKeys ?? 1000;
  const isTruncated = options?.isTruncated ?? false;

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

  const tokenXml = options?.continuationToken
    ? `\n  <ContinuationToken>${escapeXml(options.continuationToken)}</ContinuationToken>`
    : "";
  const nextTokenXml =
    isTruncated && options?.nextContinuationToken
      ? `\n  <NextContinuationToken>${escapeXml(options.nextContinuationToken)}</NextContinuationToken>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${escapeXml(bucketName)}</Name>
  <Prefix>${escapeXml(prefix)}</Prefix>
  <KeyCount>${contents.length + commonPrefixes.length}</KeyCount>
  <MaxKeys>${maxKeys}</MaxKeys>
  <IsTruncated>${isTruncated ? "true" : "false"}</IsTruncated>${tokenXml}${nextTokenXml}
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

export function xmlListMultipartUploads(
  bucket: string,
  uploads: { objectKey: string; uploadId: string; createdAt: string }[]
): string {
  const itemsXml = uploads
    .map(
      (u) => `  <Upload>
    <Key>${escapeXml(u.objectKey)}</Key>
    <UploadId>${escapeXml(u.uploadId)}</UploadId>
    <StorageClass>STANDARD</StorageClass>
    <Initiated>${escapeXml(u.createdAt)}</Initiated>
  </Upload>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ListMultipartUploadsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>${escapeXml(bucket)}</Bucket>
  <MaxUploads>1000</MaxUploads>
  <IsTruncated>false</IsTruncated>
${itemsXml}
</ListMultipartUploadsResult>`;
}

export function xmlListParts(
  bucket: string,
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string; size: number }[]
): string {
  const partsXml = parts
    .map(
      (p) => `  <Part>
    <PartNumber>${p.partNumber}</PartNumber>
    <ETag>"${escapeXml(p.etag)}"</ETag>
    <Size>${p.size}</Size>
  </Part>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ListPartsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>${escapeXml(bucket)}</Bucket>
  <Key>${escapeXml(key)}</Key>
  <UploadId>${escapeXml(uploadId)}</UploadId>
  <StorageClass>STANDARD</StorageClass>
  <MaxParts>1000</MaxParts>
  <IsTruncated>false</IsTruncated>
${partsXml}
</ListPartsResult>`;
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

export function xmlDeleteResult(
  deleted: string[],
  errors: { key: string; code: string; message: string }[] = []
): string {
  const deletedXml = deleted
    .map((k) => `  <Deleted>\n    <Key>${escapeXml(k)}</Key>\n  </Deleted>`)
    .join("\n");
  const errorsXml = errors
    .map(
      (e) => `  <Error>\n    <Key>${escapeXml(e.key)}</Key>\n    <Code>${escapeXml(e.code)}</Code>\n    <Message>${escapeXml(e.message)}</Message>\n  </Error>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
${deletedXml}
${errorsXml}
</DeleteResult>`;
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
