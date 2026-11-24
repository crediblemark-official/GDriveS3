import { describe, it, expect } from "bun:test";
import {
  xmlListBuckets,
  xmlListObjectsV2,
  xmlInitiateMultipart,
  xmlCompleteMultipart,
  xmlDeleteResult,
  xmlError,
} from "../server/s3/xml";

describe("S3 XML Serializers", () => {
  it("should serialize ListAllMyBucketsResult", () => {
    const buckets = [
      { name: "bucket-one", createdAt: "2026-11-24T12:00:00Z" },
      { name: "bucket-two", createdAt: "2026-11-24T13:00:00Z" },
    ];
    const xml = xmlListBuckets(buckets);
    expect(xml).toContain("<ListAllMyBucketsResult");
    expect(xml).toContain("<Name>bucket-one</Name>");
    expect(xml).toContain("<Name>bucket-two</Name>");
  });

  it("should serialize ListBucketResult (ListObjectsV2) with prefixes", () => {
    const contents = [
      { key: "docs/readme.txt", size: 1024, etag: "abc123etag", updatedAt: "2026-11-24T14:00:00Z" },
    ];
    const commonPrefixes = ["images/", "backups/"];
    const xml = xmlListObjectsV2("my-bucket", "prefix/", contents, commonPrefixes);

    expect(xml).toContain("<ListBucketResult");
    expect(xml).toContain("<Name>my-bucket</Name>");
    expect(xml).toContain("<Key>docs/readme.txt</Key>");
    expect(xml).toContain("<ETag>\"abc123etag\"</ETag>");
    expect(xml).toContain("<Prefix>images/</Prefix>");
    expect(xml).toContain("<Prefix>backups/</Prefix>");
  });

  it("should serialize InitiateMultipartUploadResult", () => {
    const xml = xmlInitiateMultipart("my-bucket", "photos/pic.jpg", "upload-id-999");
    expect(xml).toContain("<InitiateMultipartUploadResult");
    expect(xml).toContain("<Bucket>my-bucket</Bucket>");
    expect(xml).toContain("<Key>photos/pic.jpg</Key>");
    expect(xml).toContain("<UploadId>upload-id-999</UploadId>");
  });

  it("should serialize CompleteMultipartUploadResult", () => {
    const xml = xmlCompleteMultipart("my-bucket", "photos/pic.jpg", "combined-etag-123");
    expect(xml).toContain("<CompleteMultipartUploadResult");
    expect(xml).toContain("<ETag>\"combined-etag-123\"</ETag>");
    expect(xml).toContain("<Location>/my-bucket/photos/pic.jpg</Location>");
  });

  it("should serialize DeleteResult for multi-object delete", () => {
    const deleted = ["file1.txt", "file2.txt"];
    const errors = [{ key: "file3.txt", code: "AccessDenied", message: "Forbidden" }];
    const xml = xmlDeleteResult(deleted, errors);

    expect(xml).toContain("<DeleteResult");
    expect(xml).toContain("<Deleted>\n    <Key>file1.txt</Key>");
    expect(xml).toContain("<Error>\n    <Key>file3.txt</Key>");
    expect(xml).toContain("<Code>AccessDenied</Code>");
  });

  it("should properly escape special XML characters", () => {
    const xml = xmlError("TestCode", "Error with <tags> & \"quotes\"", "res/<key>&id");
    expect(xml).toContain("&lt;tags&gt;");
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&quot;quotes&quot;");
  });
});
