import { Body, Column, Container, Head, Heading, Html, Link, Preview, Row, Section, Text } from "@react-email/components";

export type TicketNotificationProps = {
  productName: string;
  primaryColor: string;
  reference: string;
  title: string;
  statusLabel: string;
  /** 0-3: New Ticket -> In Progress -> Waiting on Customer -> Closed. */
  trackerStage: number;
  contextLine: string;
  ticketUrl: string;
};

const TRACKER_STEPS = ["New Ticket", "In Progress", "Waiting on Customer", "Closed"];

/** 4-stage visual tracker (email flow design §"Ticket Numbering + Status Tracker") — table-based layout, no flex/grid, for email-client compatibility. */
function StatusTracker({ stage, primaryColor }: { stage: number; primaryColor: string }) {
  return (
    <Section style={{ margin: "0 0 24px" }}>
      <Row>
        {TRACKER_STEPS.map((step, i) => (
          <Column key={step} align="center" style={{ padding: "0 2px" }}>
            <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
              <tbody>
                <tr>
                  <td
                    style={{
                      height: "4px",
                      fontSize: 0,
                      lineHeight: "4px",
                      backgroundColor: i <= stage ? primaryColor : "#E0E0E0",
                      borderRadius: "2px",
                    }}
                  >
                    &nbsp;
                  </td>
                </tr>
              </tbody>
            </table>
            <Text
              style={{
                fontSize: "10px",
                fontWeight: i === stage ? 700 : 500,
                color: i <= stage ? "#000000" : "#AEAEAE",
                margin: "6px 0 0",
                lineHeight: "1.2",
              }}
            >
              {step}
            </Text>
          </Column>
        ))}
      </Row>
    </Section>
  );
}

// Shared template for every ticket-lifecycle email (created, reply, status change).
// Per brand voice: plain, direct, no filler — reference, title, status, one
// contextual line, and a deep link. See STRALIS_BRAND_GUIDELINES §06.
export function TicketNotificationEmail({
  productName,
  primaryColor,
  reference,
  title,
  statusLabel,
  trackerStage,
  contextLine,
  ticketUrl,
}: TicketNotificationProps) {
  return (
    <Html>
      <Head />
      <Preview>{contextLine}</Preview>
      <Body style={{ backgroundColor: "#EBEBEB", fontFamily: "Helvetica, Arial, sans-serif", margin: 0, padding: "32px 0" }}>
        <Container style={{ backgroundColor: "#FFFFFF", padding: "32px", maxWidth: "480px", border: "1px solid #CCCCCC" }}>
          <Text style={{ fontSize: "13px", fontWeight: 600, color: "#000000", margin: "0 0 24px" }}>{productName}</Text>
          <Text style={{ fontFamily: "monospace", fontSize: "12px", color: "#4C4C4C", margin: "0 0 4px" }}>{reference}</Text>
          <Heading style={{ fontSize: "20px", fontWeight: 700, color: "#000000", margin: "0 0 16px" }}>{title}</Heading>
          <StatusTracker stage={trackerStage} primaryColor={primaryColor} />
          <Text style={{ fontSize: "13px", color: "#4C4C4C", margin: "0 0 8px" }}>
            Status: <span style={{ color: "#000000", fontWeight: 600 }}>{statusLabel}</span>
          </Text>
          <Text style={{ fontSize: "14px", color: "#000000", margin: "0 0 24px" }}>{contextLine}</Text>
          <Link
            href={ticketUrl}
            style={{
              display: "inline-block",
              backgroundColor: primaryColor,
              color: "#FFFFFF",
              fontSize: "13px",
              fontWeight: 600,
              padding: "10px 20px",
              borderRadius: "999px",
              textDecoration: "none",
            }}
          >
            View ticket
          </Link>
          <Section style={{ marginTop: "32px", borderTop: "1px solid #EBEBEB", paddingTop: "16px" }}>
            <Text style={{ fontSize: "11px", color: "#AEAEAE", margin: 0 }}>Sent by {productName}.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
